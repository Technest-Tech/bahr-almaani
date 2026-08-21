<?php

namespace Tests\Unit;

use App\Support\PlacementConfig;
use PHPUnit\Framework\TestCase;

/**
 * The physical geometry the merge draws with — see App\Support\PlacementConfig.
 */
class LetterheadGeometryTest extends TestCase
{
    /** The office's own letterhead: A4, so height ÷ width. */
    private const A4_RATIO = 296.93 / 209.97;

    private function letterhead(array $overrides = []): array
    {
        return PlacementConfig::normalize($overrides, 'letterhead');
    }

    /** The normal case must not move: on A4 a full-bleed letterhead still fills the sheet. */
    public function test_a_full_bleed_letterhead_still_covers_an_a4_page_edge_to_edge(): void
    {
        $rect = PlacementConfig::resolveRect($this->letterhead(), 210.0, 297.0, self::A4_RATIO);

        $this->assertEqualsWithDelta(210.0, $rect['width'], 0.05);
        $this->assertEqualsWithDelta(297.0, $rect['height'], 0.1);
        $this->assertEqualsWithDelta(0.0, $rect['x'], 0.05);
        $this->assertSame(0.0, $rect['y']);
    }

    /**
     * The bug: fitting to page *width* on a US Letter deliverable drew the A4
     * letterhead 305.3mm tall on a 279.4mm page, dropping 25.9mm off the bottom —
     * the whole footer bar, phone, email and address with it.
     */
    public function test_a_full_bleed_letterhead_is_contained_by_a_page_that_is_not_a4(): void
    {
        $rect = PlacementConfig::resolveRect($this->letterhead(), 215.9, 279.4, self::A4_RATIO);

        $this->assertLessThanOrEqual(279.4, round($rect['y'] + $rect['height'], 2), 'The footer must stay on the page.');
        $this->assertLessThanOrEqual(215.9, round($rect['x'] + $rect['width'], 2));
        $this->assertEqualsWithDelta(279.4, $rect['height'], 0.05, 'Contained means as large as fits, not smaller.');
        // Narrower than the sheet, so a top-centre anchor centres it.
        $this->assertEqualsWithDelta((215.9 - $rect['width']) / 2, $rect['x'], 0.05);
    }

    /** An explicit width still wins: a stamp is sized in mm, not fitted to the page. */
    public function test_an_explicit_width_is_never_refitted(): void
    {
        $stamp = PlacementConfig::normalize([], 'stamp');
        $rect = PlacementConfig::resolveRect($stamp, 215.9, 279.4, 1.0);

        $this->assertSame(45.0, $rect['width']);
        $this->assertSame(45.0, $rect['height']);
    }

    public function test_the_band_is_null_until_the_letterhead_reserves_one(): void
    {
        $this->assertNull(PlacementConfig::band(null));
        $this->assertNull(PlacementConfig::band($this->letterhead()), 'Both edges default to zero.');
        $this->assertNull(PlacementConfig::band(PlacementConfig::normalize([], 'stamp')), 'A stamp has no band.');

        $this->assertSame(
            ['top' => 33.0, 'bottom' => 27.0],
            PlacementConfig::band($this->letterhead(['content_top_mm' => 33, 'content_bottom_mm' => 27])),
        );
    }

    /** A band on one edge only is still a band. */
    public function test_a_header_only_band_is_reserved(): void
    {
        $this->assertSame(
            ['top' => 33.0, 'bottom' => 0.0],
            PlacementConfig::band($this->letterhead(['content_top_mm' => 33])),
        );
    }
}
