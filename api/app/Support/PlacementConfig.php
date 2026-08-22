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

    /**
     * Validation rules for a placement arriving over the wire.
     *
     * Shared so the three doors into this geometry cannot drift apart: the admin
     * editing a template (StoreLetterheadTemplateRequest), the translator placing the
     * stamp on their own file (PortalController), and the PM adjusting it at approval
     * (ReviewController). The bounds are deliberately loose — a negative offset is a
     * legitimate bleed off the page edge — because normalize() is what actually makes
     * the value safe; these rules only reject what is not geometry at all.
     *
     * @param  string  $key  the request key holding the placement array
     * @param  bool  $withBand  include the letterhead-only content band keys
     * @return array<string, array<int, string>>
     */
    public static function rules(string $key = 'placement', bool $withBand = false): array
    {
        $rules = [
            $key => ['sometimes', 'nullable', 'array'],
            "{$key}.pages" => ['sometimes', 'in:'.implode(',', self::PAGES)],
            "{$key}.anchor" => ['sometimes', 'in:'.implode(',', self::ANCHORS)],
            "{$key}.offset_x_mm" => ['sometimes', 'numeric', 'between:-500,500'],
            "{$key}.offset_y_mm" => ['sometimes', 'numeric', 'between:-500,500'],
            "{$key}.width_mm" => ['sometimes', 'nullable', 'numeric', 'between:1,1000'],
            "{$key}.opacity" => ['sometimes', 'numeric', 'between:0,1'],
            "{$key}.layer" => ['sometimes', 'in:'.implode(',', self::LAYERS)],
        ];

        if ($withBand) {
            foreach (self::LETTERHEAD_ONLY_KEYS as $bandKey) {
                $rules["{$key}.{$bandKey}"] = ['sometimes', 'numeric', 'between:0,148'];
            }
        }

        return $rules;
    }

    public static function defaultsFor(string $kind): array
    {
        return $kind === LetterheadTemplate::KIND_STAMP
            ? self::STAMP_DEFAULTS
            : self::LETTERHEAD_DEFAULTS;
    }

    /**
     * Fill missing keys from the kind defaults and drop anything unknown, so the
     * merge job can read every key without null checks.
     *
     * @param  array|null  $defaults  layer over these instead of the kind defaults.
     *                                Used when a project overrides its stamp template's
     *                                position: the drag only ever sets x/y, and falling
     *                                back to the kind default would silently resize a
     *                                174.5mm seal to 45mm. Pass the template's own
     *                                normalized placement and only what moved changes.
     */
    public static function normalize(?array $placement, string $kind, ?array $defaults = null): array
    {
        $defaults ??= self::defaultsFor($kind);
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
     * Keep only recognised geometry keys and coerce their types, WITHOUT filling in
     * defaults for the ones that are absent.
     *
     * This is what a per-document stamp position is stored as. It is captured at
     * delivery, and nobody has chosen a stamp template yet — the PM does that at
     * approval — so defaulting the gaps here would bake in the 45mm kind default and
     * silently shrink the office's real 174.5mm seal. What is stored is only what the
     * translator actually decided (where they dragged it, and which pages), and the
     * merge layers it over the chosen template's own placement via normalize()'s
     * $defaults. Returns [] when nothing usable is present, which reads as "no opinion".
     *
     * @return array<string, mixed>
     */
    public static function sanitize(?array $placement): array
    {
        $input = $placement ?? [];
        $clean = [];

        foreach (['pages' => self::PAGES, 'anchor' => self::ANCHORS, 'layer' => self::LAYERS] as $key => $allowed) {
            if (isset($input[$key]) && is_string($input[$key]) && in_array($input[$key], $allowed, true)) {
                $clean[$key] = $input[$key];
            }
        }

        foreach (['offset_x_mm', 'offset_y_mm'] as $key) {
            if (isset($input[$key]) && is_numeric($input[$key])) {
                $clean[$key] = round((float) $input[$key], 2);
            }
        }

        if (isset($input['opacity']) && is_numeric($input['opacity'])) {
            $clean['opacity'] = round(min(1.0, max(0.0, (float) $input['opacity'])), 2);
        }

        // A null width is meaningful — "full bleed" — so presence is what counts here,
        // not truthiness.
        if (array_key_exists('width_mm', $input)) {
            $width = $input['width_mm'];

            if ($width === null || $width === '') {
                $clean['width_mm'] = null;
            } elseif (is_numeric($width)) {
                $clean['width_mm'] = round((float) $width, 2);
            }
        }

        return $clean;
    }

    /**
     * Resolve the rectangle (mm, origin at the page's top-left) the asset occupies.
     *
     * `offset_*` is measured from the anchored edge; on a centre anchor it shifts the
     * asset right/down. `web/src/lib/placement.ts` mirrors this so the admin preview
     * and the merged PDF agree.
     *
     * A null `width_mm` means "full bleed", and it is resolved by fitting the artwork
     * *inside* the page rather than to its width. Fitting to width alone only works
     * while every deliverable is A4: a US Letter page (215.9 × 279.4) took the
     * office's A4 letterhead to 215.9 × 305.3mm, pushing 25.9mm off the bottom edge
     * and taking the whole footer bar — phone, email, address — with it. On an A4
     * page the two are the same calculation, so normal output is untouched.
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
        $width = $placement['width_mm'] ?? self::containedWidth($pageWidthMm, $pageHeightMm, $assetRatio);
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
     * The widest a full-bleed asset can be drawn without any of it leaving the page.
     *
     * @param  float  $assetRatio  asset height ÷ width
     */
    private static function containedWidth(float $pageWidthMm, float $pageHeightMm, float $assetRatio): float
    {
        return $assetRatio > 0.0
            ? min($pageWidthMm, $pageHeightMm / $assetRatio)
            : $pageWidthMm;
    }

    /**
     * The band the letterhead's own header/footer artwork occupies, in mm.
     *
     * Returned separately from the placement because it is needed *before* the
     * deliverable is converted: a Word file has its page margins widened to match
     * (App\Support\DocxPageMargins) so its text is laid out inside the band at full
     * size, which is far better than shrinking the finished page into it.
     *
     * @return array{top: float, bottom: float}|null null when the letterhead reserves
     *                                               nothing, i.e. a plain overlay
     */
    public static function band(?array $placement): ?array
    {
        $top = (float) ($placement['content_top_mm'] ?? 0.0);
        $bottom = (float) ($placement['content_bottom_mm'] ?? 0.0);

        return $top <= 0.0 && $bottom <= 0.0
            ? null
            : ['top' => $top, 'bottom' => $bottom];
    }

    /**
     * Resolve where a deliverable page is drawn so it clears the letterhead's own artwork.
     *
     * The page is scaled uniformly (never enlarged) until its height fits the band left
     * between the header and footer, then centred horizontally. With no band configured
     * this returns the full page, i.e. a plain overlay.
     *
     * This is the FALLBACK path, for a deliverable that cannot be reflowed — a PDF the
     * translator hands over ready-made. Uniform scaling is the only safe option there
     * (anything else distorts the glyphs), but it costs width as well as height: the
     * office's 33/27mm band leaves a scale of 0.798, so the page also loses 21mm to a
     * blank gutter down each side. A Word deliverable avoids all of that by having its
     * margins widened before conversion — see App\Support\DocxPageMargins.
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
