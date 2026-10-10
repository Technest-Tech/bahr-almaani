<?php

namespace Tests\Unit;

use App\Support\PngAlpha;
use PHPUnit\Framework\TestCase;

/**
 * Splitting a transparent stamp into colour + soft mask without TCPDF's losses:
 * its GD path gamma-crushes the alpha and darkens the colour onto black.
 */
class PngAlphaTest extends TestCase
{
    /** @var list<string> */
    private array $files = [];

    protected function tearDown(): void
    {
        foreach ($this->files as $file) {
            @unlink($file);
        }

        parent::tearDown();
    }

    public function test_the_mask_keeps_alpha_linear(): void
    {
        // GD alpha: 0 opaque … 127 transparent. 64 is half-strength ink.
        $planes = PngAlpha::split($this->png([0, 64, 127]));

        $this->assertNotNull($planes);
        $mask = imagecreatefrompng($planes['mask']);

        $this->assertSame(255, $this->grey($mask, 0));
        // TCPDF would write 255 × 0.496^2.2 ≈ 55 here.
        $this->assertEqualsWithDelta(126, $this->grey($mask, 1), 1);
        $this->assertSame(0, $this->grey($mask, 2));

        PngAlpha::cleanUp($planes);
    }

    public function test_the_colour_of_semi_transparent_ink_is_not_darkened(): void
    {
        $planes = PngAlpha::split($this->png([64]));
        $plain = imagecreatefrompng($planes['plain']);

        $this->assertSame(['red' => 30, 'green' => 60, 'blue' => 170], array_slice(
            imagecolorsforindex($plain, imagecolorat($plain, 0, 0)), 0, 3,
        ));

        PngAlpha::cleanUp($planes);
    }

    public function test_an_opaque_png_is_left_to_tcpdf(): void
    {
        $image = imagecreatetruecolor(2, 2);
        $path = $this->temp('png');
        imagepng($image, $path);

        $this->assertNull(PngAlpha::split($path));
    }

    public function test_a_jpeg_is_left_to_tcpdf(): void
    {
        $image = imagecreatetruecolor(2, 2);
        $path = $this->temp('jpg');
        imagejpeg($image, $path);

        $this->assertNull(PngAlpha::split($path));
    }

    public function test_clean_up_removes_both_planes(): void
    {
        $planes = PngAlpha::split($this->png([64]));

        PngAlpha::cleanUp($planes);

        $this->assertFileDoesNotExist($planes['plain']);
        $this->assertFileDoesNotExist($planes['mask']);
    }

    /**
     * One row of stamp-blue pixels at the given GD alpha values.
     *
     * @param  list<int>  $alphas
     */
    private function png(array $alphas): string
    {
        $image = imagecreatetruecolor(count($alphas), 1);
        imagealphablending($image, false);
        imagesavealpha($image, true);

        foreach ($alphas as $x => $alpha) {
            imagesetpixel($image, $x, 0, imagecolorallocatealpha($image, 30, 60, 170, $alpha));
        }

        $path = $this->temp('png');
        imagepng($image, $path);

        return $path;
    }

    private function grey(\GdImage $image, int $x): int
    {
        return imagecolorsforindex($image, imagecolorat($image, $x, 0))['red'];
    }

    private function temp(string $extension): string
    {
        $path = tempnam(sys_get_temp_dir(), 'png-alpha-');
        $this->files[] = $path;
        $this->files[] = $path .= '.'.$extension;

        return $path;
    }
}
