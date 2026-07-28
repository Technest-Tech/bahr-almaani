<?php

namespace App\Support;

use App\Models\LetterheadTemplate;

/**
 * Placement geometry for the letterhead/stamp overlay (M9).
 *
 * This is the contract between the admin UI and `MergeFinalFileJob`: the job reads
 * a normalized array and never has to guess a missing key. Coordinates are PHYSICAL
 * page geometry in millimetres (FPDI/FPDF space), so anchors are left/right — not
 * RTL start/end — regardless of the document's language.
 *
 *  pages        which pages receive the asset: all | first | last
 *  anchor       {top|middle|bottom}-{left|center|right} corner the offsets grow from
 *  offset_x_mm  horizontal inset from the anchor (positive = towards the page centre)
 *  offset_y_mm  vertical inset from the anchor (positive = towards the page centre)
 *  width_mm     rendered width; null = stretch to the full page width (letterheads)
 *  opacity      0.0–1.0 alpha applied to the overlay
 *  layer        background = drawn under the text, foreground = drawn over it
 *
 * Letterheads carry two extra keys describing the band their own artwork occupies:
 *
 *  content_top_mm     header artwork height — deliverable pages start below it
 *  content_bottom_mm  footer artwork height — deliverable pages end above it
 *
 * Both default to 0 (overlay only, no reflow). When either is set the merge job
 * shrinks each deliverable page to fit between them, so translated text can never
 * collide with the letterhead's header/footer. See DocumentMergeService.
 */
class PlacementConfig
{
    public const PAGES = ['all', 'first', 'last'];

    public const ANCHORS = [
        'top-left', 'top-center', 'top-right',
        'middle-left', 'middle-center', 'middle-right',
        'bottom-left', 'bottom-center', 'bottom-right',
    ];

    public const LAYERS = ['background', 'foreground'];

    /** A full-page watermark-style letterhead on every page. */
    private const LETTERHEAD_DEFAULTS = [
        'pages' => 'all',
        'anchor' => 'top-center',
        'offset_x_mm' => 0.0,
        'offset_y_mm' => 0.0,
        'width_mm' => null,
        'opacity' => 1.0,
        'layer' => 'background',
        'content_top_mm' => 0.0,
        'content_bottom_mm' => 0.0,
    ];

    /** Keys only a letterhead carries — a stamp has no content band of its own. */
    private const LETTERHEAD_ONLY_KEYS = ['content_top_mm', 'content_bottom_mm'];

    /** A stamp sits over the signature block on the last page. */
    private const STAMP_DEFAULTS = [
        'pages' => 'last',
        'anchor' => 'bottom-right',
        'offset_x_mm' => 20.0,
        'offset_y_mm' => 20.0,
        'width_mm' => 45.0,
        'opacity' => 1.0,
        'layer' => 'foreground',
    ];

    public static function defaultsFor(string $kind): array
    {
        return $kind === LetterheadTemplate::KIND_STAMP
            ? self::STAMP_DEFAULTS
            : self::LETTERHEAD_DEFAULTS;
    }

    /**
     * Fill missing keys from the kind defaults and drop anything unknown, so the
     * merge job can read every key without null checks.
     */
    public static function normalize(?array $placement, string $kind): array
    {
        $defaults = self::defaultsFor($kind);
        $input = $placement ?? [];

        $anchor = self::pick($input, 'anchor', self::ANCHORS, $defaults['anchor']);
        $width = array_key_exists('width_mm', $input) ? $input['width_mm'] : $defaults['width_mm'];

        $normalized = [
            'pages' => self::pick($input, 'pages', self::PAGES, $defaults['pages']),
            'anchor' => $anchor,
            'offset_x_mm' => round((float) ($input['offset_x_mm'] ?? $defaults['offset_x_mm']), 2),
            'offset_y_mm' => round((float) ($input['offset_y_mm'] ?? $defaults['offset_y_mm']), 2),
            'width_mm' => $width === null || $width === '' ? null : round((float) $width, 2),
            'opacity' => round(min(1.0, max(0.0, (float) ($input['opacity'] ?? $defaults['opacity']))), 2),
            'layer' => self::pick($input, 'layer', self::LAYERS, $defaults['layer']),
        ];

        foreach (self::LETTERHEAD_ONLY_KEYS as $key) {
            if (array_key_exists($key, $defaults)) {
                // Clamped to half a page so a typo can never leave zero room for content.
                $normalized[$key] = round(min(148.0, max(0.0, (float) ($input[$key] ?? $defaults[$key]))), 2);
            }
        }

        return $normalized;
    }

    /**
     * Resolve the rectangle (mm, origin at the page's top-left) the asset occupies.
     *
     * `offset_*` is measured from the anchored edge; on a centre anchor it shifts the
     * asset right/down. `web/src/lib/placement.ts` mirrors this so the admin preview
     * and the merged PDF agree.
     *
     * @param  float  $assetRatio  asset height ÷ width
     * @return array{x: float, y: float, width: float, height: float}
     */
    public static function resolveRect(
        array $placement,
        float $pageWidthMm,
        float $pageHeightMm,
        float $assetRatio,
    ): array {
        $width = $placement['width_mm'] ?? $pageWidthMm;
        $height = $width * $assetRatio;
        [$vertical, $horizontal] = explode('-', $placement['anchor']);

        return [
            'x' => match ($horizontal) {
                'left' => $placement['offset_x_mm'],
                'right' => $pageWidthMm - $width - $placement['offset_x_mm'],
                default => ($pageWidthMm - $width) / 2 + $placement['offset_x_mm'],
            },
            'y' => match ($vertical) {
                'top' => $placement['offset_y_mm'],
                'bottom' => $pageHeightMm - $height - $placement['offset_y_mm'],
                default => ($pageHeightMm - $height) / 2 + $placement['offset_y_mm'],
            },
            'width' => $width,
            'height' => $height,
        ];
    }

    /**
     * Resolve where a deliverable page is drawn so it clears the letterhead's own artwork.
     *
     * The page is scaled uniformly (never enlarged) until its height fits the band left
     * between the header and footer, then centred horizontally. With no band configured
     * this returns the full page, i.e. a plain overlay.
     *
     * @param  array|null  $letterheadPlacement  null when the project has no letterhead
     * @return array{x: float, y: float, width: float, height: float, scale: float}
     */
    public static function resolveContentRect(
        ?array $letterheadPlacement,
        float $pageWidthMm,
        float $pageHeightMm,
    ): array {
        $top = (float) ($letterheadPlacement['content_top_mm'] ?? 0.0);
        $bottom = (float) ($letterheadPlacement['content_bottom_mm'] ?? 0.0);
        $available = $pageHeightMm - $top - $bottom;

        $scale = $available > 0 && $available < $pageHeightMm ? $available / $pageHeightMm : 1.0;
        $width = $pageWidthMm * $scale;
        $height = $pageHeightMm * $scale;

        return [
            'x' => ($pageWidthMm - $width) / 2,
            'y' => $scale < 1.0 ? $top + ($available - $height) / 2 : 0.0,
            'width' => $width,
            'height' => $height,
            'scale' => $scale,
        ];
    }

    private static function pick(array $input, string $key, array $allowed, string $fallback): string
    {
        $value = $input[$key] ?? null;

        return is_string($value) && in_array($value, $allowed, true) ? $value : $fallback;
    }
}
