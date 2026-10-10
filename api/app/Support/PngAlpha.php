<?php

namespace App\Support;

/**
 * Splits a transparent PNG into the colour plane and soft mask a PDF embeds.
 *
 * Why this exists: TCPDF does the same split itself, and on our image it does it
 * badly. With no Imagick (and the container has none) it falls back to GD, which
 *
 *   - raises every alpha value to the power 2.2 ("gamma correction" — but PNG
 *     alpha is linear coverage, there is no gamma to correct), so ink at 50% comes
 *     out at 22%; and
 *   - copies the colour onto a black canvas with blending on, so every
 *     semi-transparent pixel is darkened before it is masked.
 *
 * A stamp is a scan of ink with its paper removed, so nearly all of it *is*
 * semi-transparent. Measured on a synthetic one: the merged seal had 67% of the
 * ink density of the file it came from, thinner strokes and a greyed colour. The
 * office saw that on a certified translation and read it as "a digital stamp, not
 * the real one".
 *
 * This keeps both planes exactly as stored: alpha mapped linearly from GD's 7 bits
 * to 8, colour copied without blending. Both are written as PNG, which TCPDF
 * embeds as Flate without re-encoding.
 */
class PngAlpha
{
    /** PNG colour types that carry an alpha channel: greyscale+alpha, RGBA. */
    private const ALPHA_COLOUR_TYPES = [4, 6];

    /**
     * Split $path into two temp PNGs. The caller deletes them.
     *
     * @return array{plain: string, mask: string}|null null when the PNG is opaque
     *                                                 (TCPDF's own path is lossless
     *                                                 then) or cannot be read
     */
    public static function split(string $path): ?array
    {
        if (! self::hasAlpha($path) || ! function_exists('imagecreatefrompng')) {
            return null;
        }

        $image = @imagecreatefrompng($path);

        if ($image === false) {
            return null;
        }

        imagepalettetotruecolor($image);
        $width = imagesx($image);
        $height = imagesy($image);

        // Palette index == grey level, which is how TCPDF reads a mask it is told
        // is DeviceGray. Same construction as its own ImagePngAlpha().
        $mask = imagecreate($width, $height);

        for ($level = 0; $level < 256; $level++) {
            imagecolorallocate($mask, $level, $level, $level);
        }

        for ($x = 0; $x < $width; $x++) {
            for ($y = 0; $y < $height; $y++) {
                $alpha = (imagecolorat($image, $x, $y) >> 24) & 0x7F;
                imagesetpixel($mask, $x, $y, (int) round((127 - $alpha) * 255 / 127));
            }
        }

        // Blending off copies the colour as stored; saving without alpha then
        // drops the alpha bits and keeps RGB untouched.
        $plain = imagecreatetruecolor($width, $height);
        imagealphablending($plain, false);
        imagecopy($plain, $image, 0, 0, 0, 0, $width, $height);
        imagesavealpha($plain, false);

        $paths = [
            'plain' => tempnam(sys_get_temp_dir(), 'bahr-png-plain-').'.png',
            'mask' => tempnam(sys_get_temp_dir(), 'bahr-png-mask-').'.png',
        ];

        $written = imagepng($plain, $paths['plain']) && imagepng($mask, $paths['mask']);

        if (! $written) {
            self::cleanUp($paths);

            return null;
        }

        return $paths;
    }

    /** @param  array{plain: string, mask: string}|null  $paths */
    public static function cleanUp(?array $paths): void
    {
        foreach ($paths ?? [] as $path) {
            @unlink($path);
            // tempnam() created the extension-less twin too.
            @unlink(substr($path, 0, -4));
        }
    }

    /**
     * Colour type 4/6, or a palette/greyscale PNG with a tRNS chunk — the same two
     * cases TCPDF sends down its alpha path.
     */
    private static function hasAlpha(string $path): bool
    {
        $bytes = @file_get_contents($path);

        if ($bytes === false || strlen($bytes) < 26 || ! str_starts_with($bytes, "\x89PNG")) {
            return false;
        }

        return in_array(ord($bytes[25]), self::ALPHA_COLOUR_TYPES, true)
            || str_contains($bytes, 'tRNS');
    }
}
