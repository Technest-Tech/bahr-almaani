<?php

namespace App\Support;

use Illuminate\Support\Facades\Log;
use Symfony\Component\Process\Exception\ProcessTimedOutException;
use Symfony\Component\Process\Process;

/**
 * Thin wrapper over the `gs` binary.
 *
 * Three jobs in this app, all of them optional — every caller has a "carry on
 * without it" path, so a machine with no ghostscript still runs:
 *
 *   - shrink letterhead artwork          (App\Support\AssetOptimizer)
 *   - rewrite a PDF that FPDI refuses    (App\Services\DocumentMergeService)
 *   - extract text pdfparser mangles     (App\Services\DocumentCounter)
 *   - rasterise a scanned PDF for OCR    (App\Services\OcrCounter)
 */
class Ghostscript
{
    /** A single document; anything slower than this is stuck, not working. */
    private const TIMEOUT_SECONDS = 60;

    /** Rendering every page of a scan at 300 DPI is legitimately slower than one pass. */
    private const RASTERIZE_TIMEOUT_SECONDS = 180;

    /** Absolute path to the binary, or null when it is not installed. Memoised. */
    public static function binary(): ?string
    {
        static $resolved = false;
        static $path = null;

        if ($resolved) {
            return $path;
        }

        $resolved = true;

        foreach (['/usr/bin/gs', '/usr/local/bin/gs', '/opt/homebrew/bin/gs'] as $candidate) {
            if (is_executable($candidate)) {
                return $path = $candidate;
            }
        }

        $which = new Process(['which', 'gs']);
        $which->run();
        $found = trim($which->getOutput());

        return $path = ($which->isSuccessful() && $found !== '' && is_executable($found)) ? $found : null;
    }

    public static function available(): bool
    {
        return self::binary() !== null;
    }

    /**
     * Rewrite $path through pdfwrite and return the bytes.
     *
     * Always PDF 1.4: FPDI 2.x free cannot read the compressed cross-reference
     * streams of PDF 1.5+, and this output has to stay mergeable.
     *
     * @param  list<string>  $flags  extra pdfwrite options
     */
    public static function rewritePdf(string $path, array $flags, string $what): ?string
    {
        $bytes = self::run($path, [
            '-sDEVICE=pdfwrite',
            '-dCompatibilityLevel=1.4',
            ...$flags,
        ], 'pdf', $what);

        // A truncated or non-PDF result would break the merge silently.
        return $bytes !== null && str_starts_with($bytes, '%PDF-') ? $bytes : null;
    }

    /**
     * Plain text of every page.
     *
     * Used only as a second opinion when pdfparser's output is obviously wrong —
     * see DocumentCounter::countPdf(). Note that ghostscript emits Arabic in visual
     * rather than logical order, which is irrelevant for counting and would matter
     * a great deal if this were ever used to display or index text.
     */
    public static function extractText(string $path): ?string
    {
        return self::run($path, ['-sDEVICE=txtwrite'], 'txt', 'text extraction');
    }

    /**
     * Render every page of a PDF to a grayscale PNG, for OCR.
     *
     * 300 DPI is what tesseract's models are trained around; grayscale because
     * colour buys recognition nothing and triples the pixel data.
     *
     * @return list<string>|null absolute paths in page order, or null on failure
     */
    public static function rasterize(string $path, string $directory, int $dpi = 300): ?array
    {
        $binary = self::binary();

        if ($binary === null) {
            return null;
        }

        try {
            $process = new Process([
                $binary,
                '-q', '-dNOPAUSE', '-dBATCH', '-dSAFER',
                '-sDEVICE=pnggray',
                "-r{$dpi}",
                '-sOutputFile='.$directory.'/page-%04d.png',
                $path,
            ]);
            $process->setTimeout(self::RASTERIZE_TIMEOUT_SECONDS);
            $process->run();

            if (! $process->isSuccessful()) {
                Log::warning('Ghostscript rasterize failed', [
                    'path' => basename($path),
                    'exit' => $process->getExitCode(),
                    'stderr' => mb_substr($process->getErrorOutput(), 0, 500),
                ]);

                return null;
            }

            $pages = glob($directory.'/page-*.png') ?: [];
            sort($pages);

            return $pages === [] ? null : $pages;
        } catch (ProcessTimedOutException) {
            Log::warning('Ghostscript rasterize timed out', ['path' => basename($path)]);

            return null;
        }
    }

    /**
     * @param  list<string>  $flags
     */
    private static function run(string $path, array $flags, string $extension, string $what): ?string
    {
        $binary = self::binary();

        if ($binary === null) {
            return null;
        }

        $output = tempnam(sys_get_temp_dir(), 'gs-').'.'.$extension;

        try {
            $process = new Process([
                $binary,
                '-q', '-dNOPAUSE', '-dBATCH', '-dSAFER',
                ...$flags,
                "-sOutputFile={$output}",
                $path,
            ]);
            $process->setTimeout(self::TIMEOUT_SECONDS);
            $process->run();

            if (! $process->isSuccessful() || ! is_file($output)) {
                Log::warning("Ghostscript {$what} failed", [
                    'path' => basename($path),
                    'exit' => $process->getExitCode(),
                    'stderr' => mb_substr($process->getErrorOutput(), 0, 500),
                ]);

                return null;
            }

            $bytes = file_get_contents($output);

            return is_string($bytes) ? $bytes : null;
        } catch (ProcessTimedOutException) {
            Log::warning("Ghostscript {$what} timed out", ['path' => basename($path)]);

            return null;
        } finally {
            if (is_file($output)) {
                @unlink($output);
            }
        }
    }
}
