<?php

namespace App\Support;

/**
 * Crops the dead margin off a stamp scan.
 *
 * Offices scan their stamp on a full sheet of paper, so the asset that reaches us is
 * an A4 canvas that is ~99% empty. Placing that verbatim makes `width_mm` describe the
 * *paper*, not the stamp — a 45 mm placement renders an 11 mm stamp. Trimming to the
 * ink bounding box on upload makes the placement geometry mean what the admin expects.
 *
 * Transparent PNGs are trimmed on their alpha channel; anything else on near-white.
 */
class ImageTrimmer
{
    /** Alpha ≤ this (0 = opaque, 127 = transparent in GD) counts as ink. */
    private const ALPHA_INK_THRESHOLD = 100;

    /** Channel average below this counts as ink on an opaque scan. */
    private const WHITE_INK_THRESHOLD = 245;

    /** Keep a hair of paper around the ink so the crop never clips an edge. */
    private const PADDING_RATIO = 0.01;

    /**
     * Trim $absolutePath in place. Returns true when the file was rewritten.
     *
     * Never throws: a stamp that cannot be trimmed is still a usable stamp, it just
     * needs the admin to size it by hand.
     */
    public static function trim(string $absolutePath): bool
    {
        if (! is_file($absolutePath) || ! function_exists('imagecreatefrompng')) {
            return false;
        }

        $extension = strtolower(pathinfo($absolutePath, PATHINFO_EXTENSION));

        $image = match ($extension) {
            'png' => @imagecreatefrompng($absolutePath),
            'jpg', 'jpeg' => @imagecreatefromjpeg($absolutePath),
            default => false,
        };

        if ($image === false) {
            return false;
        }

        try {
            $box = self::inkBounds($image);

            if ($box === null) {
                return false;
            }

            [$left, $top, $right, $bottom] = $box;
            $width = $right - $left + 1;
            $height = $bottom - $top + 1;

            // Already tight — nothing worth rewriting.
            if ($width >= imagesx($image) * 0.98 && $height >= imagesy($image) * 0.98) {
                return false;
            }

            $pad = (int) round(max($width, $height) * self::PADDING_RATIO);
            $left = max(0, $left - $pad);
            $top = max(0, $top - $pad);
            $width = min(imagesx($image) - $left, $width + $pad * 2);
            $height = min(imagesy($image) - $top, $height + $pad * 2);

            $cropped = imagecrop($image, ['x' => $left, 'y' => $top, 'width' => $width, 'height' => $height]);

            if ($cropped === false) {
                return false;
            }

            try {
                imagealphablending($cropped, false);
                imagesavealpha($cropped, true);

                return $extension === 'png'
                    ? imagepng($cropped, $absolutePath)
                    : imagejpeg($cropped, $absolutePath, 92);
            } finally {
                imagedestroy($cropped);
            }
        } finally {
            imagedestroy($image);
        }
    }

    /** Sample at most this many pixels — a 300dpi A4 scan is 8.7M and runs in-request. */
    private const SAMPLE_BUDGET = 250000;

    /** A row/column must reach this share of the densest one to count as content. */
    private const DENSITY_FLOOR = 0.02;

    /**
     * Bounding box of the ink, or null when the image is blank.
     *
     * Rows and columns are kept only once their ink count clears a share of the
     * densest row/column. Scanner dust and background-removal specks survive on real
     * client scans, and a plain "any ink pixel" box would stretch to the sheet edges
     * and trim nothing.
     *
     * Sampled on a grid rather than pixel-by-pixel; the step is added back as padding
     * so the box still contains the true ink extent.
     *
     * @return array{0: int, 1: int, 2: int, 3: int}|null [left, top, right, bottom]
     */
    private static function inkBounds(\GdImage $image): ?array
    {
        $imageWidth = imagesx($image);
        $imageHeight = imagesy($image);
        $step = max(1, (int) ceil(sqrt($imageWidth * $imageHeight / self::SAMPLE_BUDGET)));

        $columns = [];
        $rows = [];

        for ($y = 0; $y < $imageHeight; $y += $step) {
            for ($x = 0; $x < $imageWidth; $x += $step) {
                if (! self::isInk(imagecolorat($image, $x, $y))) {
                    continue;
                }

                $columns[$x] = ($columns[$x] ?? 0) + 1;
                $rows[$y] = ($rows[$y] ?? 0) + 1;
            }
        }

        if ($rows === []) {
            return null;
        }

        $horizontal = self::denseRange($columns);
        $vertical = self::denseRange($rows);

        if ($horizontal === null || $vertical === null) {
            return null;
        }

        return [
            max(0, $horizontal[0] - $step),
            max(0, $vertical[0] - $step),
            min($imageWidth - 1, $horizontal[1] + $step),
            min($imageHeight - 1, $vertical[1] + $step),
        ];
    }

    /**
     * First and last offset whose ink count clears the noise floor.
     *
     * @param  array<int, int>  $counts  offset => ink samples
     * @return array{0: int, 1: int}|null
     */
    private static function denseRange(array $counts): ?array
    {
        $threshold = max(2, (int) ceil(max($counts) * self::DENSITY_FLOOR));
        $kept = array_keys(array_filter($counts, fn (int $count): bool => $count >= $threshold));

        return $kept === [] ? null : [min($kept), max($kept)];
    }

    /** Ink = visible enough to matter, and not paper-white when fully opaque. */
    private static function isInk(int $colour): bool
    {
        $alpha = ($colour >> 24) & 0x7F;

        if ($alpha >= self::ALPHA_INK_THRESHOLD) {
            return false;
        }

        if ($alpha > 0) {
            return true;
        }

        $average = ((($colour >> 16) & 0xFF) + (($colour >> 8) & 0xFF) + ($colour & 0xFF)) / 3;

        return $average < self::WHITE_INK_THRESHOLD;
    }
}
