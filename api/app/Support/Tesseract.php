<?php

namespace App\Support;

use Illuminate\Support\Facades\Log;
use Symfony\Component\Process\Exception\ProcessTimedOutException;
use Symfony\Component\Process\Process;

/**
 * Thin wrapper over the `tesseract` binary (OCR).
 *
 * Optional at runtime like Ghostscript: with the binary or the Arabic model
 * missing, every caller falls back to "not countable" — exactly the behaviour
 * the system had before OCR existed.
 */
class Tesseract
{
    /** One page of a scanned document; anything slower than this is stuck, not working. */
    private const TIMEOUT_SECONDS = 90;

    /**
     * Words below this confidence are noise — stamp edges, borders, handwriting.
     * Dropping them here keeps them out of a billable number.
     */
    private const MIN_WORD_CONFIDENCE = 40.0;

    /** Absolute path to the binary, or null when it is not installed. Memoised. */
    public static function binary(): ?string
    {
        static $resolved = false;
        static $path = null;

        if ($resolved) {
            return $path;
        }

        $resolved = true;

        foreach (['/usr/bin/tesseract', '/usr/local/bin/tesseract', '/opt/homebrew/bin/tesseract'] as $candidate) {
            if (is_executable($candidate)) {
                return $path = $candidate;
            }
        }

        $which = new Process(['which', 'tesseract']);
        $which->run();
        $found = trim($which->getOutput());

        return $path = ($which->isSuccessful() && $found !== '' && is_executable($found)) ? $found : null;
    }

    public static function available(): bool
    {
        return self::binary() !== null;
    }

    /**
     * OCR one page image and return the confident words plus their mean confidence.
     *
     * Reads the TSV output rather than plain text so every word carries its own
     * confidence — the caller uses the mean to refuse an unreadable page outright
     * rather than store a wrong number.
     *
     * @return array{text: string, mean_confidence: float}|null null when the binary is missing or the run failed
     */
    public static function readImage(string $imagePath): ?array
    {
        $binary = self::binary();

        if ($binary === null) {
            return null;
        }

        try {
            $process = new Process(
                [$binary, $imagePath, 'stdout', '-l', 'ara+eng', '--psm', '3', 'tsv'],
                null,
                // The worker shares its CPUs with php-fpm; OpenMP threads buy
                // little on a single page and starve everything else.
                ['OMP_THREAD_LIMIT' => '1'],
            );
            $process->setTimeout(self::TIMEOUT_SECONDS);
            $process->run();

            if (! $process->isSuccessful()) {
                Log::warning('Tesseract OCR failed', [
                    'path' => basename($imagePath),
                    'exit' => $process->getExitCode(),
                    'stderr' => mb_substr($process->getErrorOutput(), 0, 500),
                ]);

                return null;
            }

            return self::parseTsv($process->getOutput());
        } catch (ProcessTimedOutException) {
            Log::warning('Tesseract OCR timed out', ['path' => basename($imagePath)]);

            return null;
        }
    }

    /** @return array{text: string, mean_confidence: float} */
    private static function parseTsv(string $tsv): array
    {
        $words = [];
        $confidenceSum = 0.0;

        foreach (explode("\n", $tsv) as $index => $line) {
            if ($index === 0 || trim($line) === '') {
                continue; // header
            }

            $columns = explode("\t", $line);

            // Level 5 rows are recognised words; everything above is layout.
            if (count($columns) < 12 || $columns[0] !== '5') {
                continue;
            }

            $confidence = (float) $columns[10];
            $text = trim($columns[11]);

            // A "word" with no letter or digit is a border fragment, not content.
            if ($text === '' || $confidence < self::MIN_WORD_CONFIDENCE || ! preg_match('/[\p{L}\p{N}]/u', $text)) {
                continue;
            }

            $words[] = $text;
            $confidenceSum += $confidence;
        }

        return [
            'text' => implode(' ', $words),
            'mean_confidence' => $words === [] ? 0.0 : $confidenceSum / count($words),
        ];
    }
}
