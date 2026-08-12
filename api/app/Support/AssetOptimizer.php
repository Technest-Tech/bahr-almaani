<?php

namespace App\Support;

/**
 * Shrinks a letterhead or stamp asset in place, before it is ever merged.
 *
 * Why this exists: the client's letterhead was a 17.6 MB A4 scan at 300 DPI, and the
 * merge redraws it into *every* page of *every* delivery. A 20 KB translation left
 * the system as a 3.3 MB PDF — roughly 99% letterhead — and the client experienced
 * that as "downloads are slow". The network was never the problem; the payload was.
 *
 * Two paths, because the asset can be either:
 *   - PDF   → ghostscript, downsampling the embedded images and leaving vectors alone
 *   - image → GD, capped at a sane pixel width and re-encoded
 *
 * Three rules hold for both, and the tests pin all three:
 *   1. **Never throw.** A letterhead that cannot be optimised is still a valid
 *      letterhead. Failure logs and keeps the original, it does not fail the upload.
 *   2. **Never grow the file.** An already-lean asset comes back untouched; some
 *      inputs (a small vector PDF) get *bigger* through ghostscript.
 *   3. **PDF 1.4, always.** FPDI 2.x free cannot read the compressed cross-reference
 *      streams of PDF 1.5+, so a "modern" output would parse fine everywhere except
 *      the one place it matters and break every merge. Pinned, and tested.
 */
class AssetOptimizer
{
    /**
     * Target resolution for images embedded in a PDF letterhead.
     *
     * 300 is deliberately *not* a downsample: A4 at 300 DPI is 2480 px, which is
     * exactly what the client's scanner produced, so every original pixel survives.
     * Nearly all of the saving comes from re-encoding, not from throwing detail away
     * — measured on their real letterhead:
     *
     *   300 dpi → 280 KB   (98% smaller, indistinguishable from the original)
     *   150 dpi →  96 KB   (99% smaller, wordmark visibly softened)
     *
     * The extra 184 KB costs a client on a 5 Mbit/s line about 0.3 s. Blurring the
     * letterhead on a certified legal document to save that is a bad trade, so the
     * default keeps the pixels. Lower it only if the office asks for smaller files
     * and accepts the result on paper.
     */
    private const DEFAULT_DPI = 300;

    /** A4 at 300 DPI. Same principle: cap runaway uploads, never soften a real scan. */
    private const MAX_IMAGE_WIDTH = 2480;

    private const JPEG_QUALITY = 82;

    /**
     * Optimise the file at $absolutePath in place.
     *
     * @return array{before:int, after:int, applied:bool} byte counts either way, so
     *                                                    the caller can report the saving
     */
    public static function optimize(string $absolutePath): array
    {
        clearstatcache(true, $absolutePath);
        $before = is_file($absolutePath) ? (int) filesize($absolutePath) : 0;

        if ($before === 0) {
            return ['before' => 0, 'after' => 0, 'applied' => false];
        }

        $extension = strtolower(pathinfo($absolutePath, PATHINFO_EXTENSION));

        $optimized = match ($extension) {
            'pdf' => self::optimizePdf($absolutePath),
            'png', 'jpg', 'jpeg' => self::optimizeImage($absolutePath, $extension),
            default => null,
        };

        // Rule 2: a result that is not smaller is not a result.
        if ($optimized === null || strlen($optimized) === 0 || strlen($optimized) >= $before) {
            return ['before' => $before, 'after' => $before, 'applied' => false];
        }

        if (@file_put_contents($absolutePath, $optimized) === false) {
            return ['before' => $before, 'after' => $before, 'applied' => false];
        }

        clearstatcache(true, $absolutePath);

        return ['before' => $before, 'after' => strlen($optimized), 'applied' => true];
    }

    /** True when ghostscript is on PATH — false in a bare dev checkout, and that is fine. */
    public static function supportsPdf(): bool
    {
        return Ghostscript::available();
    }

    /**
     * Rewrite a PDF as plain PDF 1.4, changing nothing else.
     *
     * FPDI 2.x free cannot read object streams or compressed cross-reference tables,
     * which every modern producer emits — a translator delivering a PDF saved by a
     * recent Word, Acrobat or phone scanner app hands us a file the merge simply
     * cannot open ("This PDF document probably uses a compression technique which is
     * not supported by the free parser shipped with FPDI"). It happened on
     * BM-2026-00006 in production. Ghostscript rewrites the same content into the
     * older container, and FPDI reads it.
     *
     * No downsampling here on purpose: this is the translator's finished work, and
     * the only thing wrong with it is the container version.
     *
     * @return string|null the rewritten bytes, or null when ghostscript is absent or fails
     */
    public static function normalizeToPdf14(string $absolutePath): ?string
    {
        return Ghostscript::rewritePdf($absolutePath, [], 'PDF 1.4 normalisation');
    }

    private static function optimizePdf(string $path): ?string
    {
        $dpi = (int) config('services.ghostscript.dpi', self::DEFAULT_DPI);

        return Ghostscript::rewritePdf($path, [
            '-dDetectDuplicateImages=true',
            '-dDownsampleColorImages=true',
            '-dColorImageDownsampleType=/Bicubic',
            "-dColorImageResolution={$dpi}",
            '-dDownsampleGrayImages=true',
            '-dGrayImageDownsampleType=/Bicubic',
            "-dGrayImageResolution={$dpi}",
            // Line art rasterised as 1-bit: downsampling it is what makes scanned
            // text look ragged, so it keeps roughly twice the resolution.
            '-dDownsampleMonoImages=true',
            '-dMonoImageDownsampleType=/Subsample',
            '-dMonoImageResolution='.($dpi * 2),
            '-dCompressFonts=true',
            '-dSubsetFonts=true',
        ], 'letterhead optimisation');
    }

    /**
     * Downsample a raster asset and re-encode it in the same format.
     *
     * Deliberately not converting PNG→JPEG even when the artwork is opaque and JPEG
     * would be smaller: the extension is baked into `disk_path` and drives both the
     * stored mime type and the preview route, so swapping the container means
     * rewriting the record too. Re-encoding alone is usually enough, and anything
     * already at or below A4/300 DPI keeps its pixel dimensions untouched.
     *
     * Alpha is preserved because a stamp sits *over* the translated text — flattening
     * it onto white would hide the words underneath.
     */
    private static function optimizeImage(string $path, string $extension): ?string
    {
        if (! function_exists('imagecreatefromstring')) {
            return null;
        }

        $bytes = @file_get_contents($path);

        if ($bytes === false) {
            return null;
        }

        $image = @imagecreatefromstring($bytes);

        if ($image === false) {
            return null;
        }

        try {
            $keepAlpha = $extension === 'png';

            if (imagesx($image) > self::MAX_IMAGE_WIDTH) {
                if ($keepAlpha) {
                    imagealphablending($image, false);
                    imagesavealpha($image, true);
                }

                $target = self::scale($image, self::MAX_IMAGE_WIDTH);

                if ($target === null) {
                    return null;
                }

                imagedestroy($image);
                $image = $target;
            }

            if ($keepAlpha) {
                imagealphablending($image, false);
                imagesavealpha($image, true);
            }

            ob_start();
            $ok = $keepAlpha ? imagepng($image, null, 9) : imagejpeg($image, null, self::JPEG_QUALITY);
            $encoded = (string) ob_get_clean();

            return $ok && $encoded !== '' ? $encoded : null;
        } finally {
            imagedestroy($image);
        }
    }

    /**
     * Scale to $width, preserving aspect ratio.
     *
     * The interpolation mode is tried rather than assumed: `imagescale` with
     * IMG_BICUBIC returns false outright on GD 2.3.3 (both with an explicit height
     * and with -1), which silently turned the whole image path into a no-op. The
     * libgd build differs between this host and the Alpine container, so the fallback
     * chain stays even though the last entry is the documented default.
     */
    private static function scale(\GdImage $image, int $width): ?\GdImage
    {
        foreach ([IMG_BICUBIC_FIXED, IMG_BILINEAR_FIXED] as $mode) {
            $scaled = @imagescale($image, $width, -1, $mode);

            if ($scaled !== false) {
                return $scaled;
            }
        }

        $scaled = @imagescale($image, $width);

        return $scaled === false ? null : $scaled;
    }
}
