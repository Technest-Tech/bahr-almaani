<?php

namespace Tests\Feature;

use App\Support\AssetOptimizer;
use setasign\Fpdi\Tcpdf\Fpdi;
use Tests\TestCase;

class AssetOptimizerTest extends TestCase
{
    private string $workdir;

    protected function setUp(): void
    {
        parent::setUp();
        $this->workdir = sys_get_temp_dir().'/optimizer-'.bin2hex(random_bytes(4));
        mkdir($this->workdir);
    }

    protected function tearDown(): void
    {
        foreach (glob($this->workdir.'/*') ?: [] as $file) {
            @unlink($file);
        }
        @rmdir($this->workdir);
        parent::tearDown();
    }

    public function test_a_large_scan_is_downsampled(): void
    {
        // Wider than the A4/300 DPI cap, so the downsample branch actually runs.
        $path = $this->writeScan('scan.jpg', 3400, 4800);
        $before = filesize($path);

        $result = AssetOptimizer::optimize($path);

        $this->assertTrue($result['applied'], 'A 2480px scan should have been downsampled.');
        $this->assertLessThan($before, $result['after']);
        $this->assertSame($before, $result['before']);

        [$width] = getimagesize($path);
        $this->assertLessThanOrEqual(2480, $width);
    }

    /**
     * Rule 2 again, on the case that actually shows up.
     *
     * A clean letterhead *export* is line art on white: PNG already stores it in a
     * few KB, and bicubic downsampling antialiases the edges into hundreds of new
     * colours, which makes the re-encoded file BIGGER. The optimiser has to notice
     * and keep the original — this is the input we are asking the client for, so
     * making it worse would defeat the whole exercise.
     */
    public function test_line_art_that_would_grow_is_kept_as_is(): void
    {
        $path = $this->workdir.'/lineart.png';
        $image = imagecreatetruecolor(2480, 3507);
        imagefill($image, 0, 0, imagecolorallocate($image, 255, 255, 255));
        $ink = imagecolorallocate($image, 20, 35, 65);
        for ($y = 200; $y < 3300; $y += 120) {
            imagefilledrectangle($image, 300, $y, 2100, $y + 26, $ink);
        }
        imagepng($image, $path, 9);
        imagedestroy($image);

        $original = file_get_contents($path);
        $result = AssetOptimizer::optimize($path);

        $this->assertSame($result['before'], $result['after']);
        $this->assertSame($original, file_get_contents($path));
    }

    /** Rule 2: an asset that is already lean must come back byte-identical. */
    public function test_an_already_small_asset_is_left_alone(): void
    {
        $path = $this->writePng('small.png', 120, 60);
        $original = file_get_contents($path);

        $result = AssetOptimizer::optimize($path);

        $this->assertFalse($result['applied']);
        $this->assertSame($result['before'], $result['after']);
        $this->assertSame($original, file_get_contents($path), 'The file must not have been rewritten.');
    }

    /** A stamp sits over the text; flattening its alpha would hide the words. */
    public function test_transparency_survives_optimisation(): void
    {
        $path = $this->workdir.'/stamp.png';
        $image = imagecreatetruecolor(2000, 2000);
        imagealphablending($image, false);
        imagesavealpha($image, true);
        imagefill($image, 0, 0, imagecolorallocatealpha($image, 0, 0, 0, 127));
        imagefilledellipse($image, 1000, 1000, 1200, 1200, imagecolorallocate($image, 190, 30, 45));
        imagepng($image, $path);
        imagedestroy($image);

        AssetOptimizer::optimize($path);

        $result = imagecreatefrompng($path);
        imagealphablending($result, false);
        $corner = (imagecolorat($result, 2, 2) >> 24) & 0x7F;
        imagedestroy($result);

        $this->assertGreaterThan(0, $corner, 'The transparent corner became opaque.');
    }

    /** Rule 1: nothing about a broken input may reach the caller as an exception. */
    public function test_a_corrupt_file_is_returned_untouched(): void
    {
        $path = $this->workdir.'/broken.png';
        file_put_contents($path, 'this is definitely not a png');

        $result = AssetOptimizer::optimize($path);

        $this->assertFalse($result['applied']);
        $this->assertSame('this is definitely not a png', file_get_contents($path));
    }

    public function test_an_unknown_extension_is_ignored(): void
    {
        $path = $this->workdir.'/notes.txt';
        file_put_contents($path, str_repeat('x', 5000));

        $this->assertFalse(AssetOptimizer::optimize($path)['applied']);
    }

    public function test_a_missing_file_reports_zero_rather_than_throwing(): void
    {
        $this->assertSame(
            ['before' => 0, 'after' => 0, 'applied' => false],
            AssetOptimizer::optimize($this->workdir.'/nope.pdf'),
        );
    }

    /**
     * Rule 3, and the one that matters most.
     *
     * FPDI 2.x free has no reader for the compressed cross-reference streams that
     * PDF 1.5+ uses. If ghostscript ever emits a newer PDF, the optimised letterhead
     * still opens fine in every viewer — and every single merge breaks. This test is
     * the tripwire.
     */
    public function test_an_optimised_pdf_is_still_parseable_by_the_merge_engine(): void
    {
        if (! AssetOptimizer::supportsPdf()) {
            $this->markTestSkipped('ghostscript not installed in this environment');
        }

        $path = $this->writeImageHeavyPdf('letterhead.pdf');
        $before = filesize($path);

        $result = AssetOptimizer::optimize($path);

        $this->assertStringStartsWith('%PDF-', file_get_contents($path));
        $this->assertLessThan($before, $result['after'], 'A 300 DPI scan in a PDF should shrink.');

        // The real assertion: FPDI can still import page 1, which is exactly what
        // DocumentMergeService::importFirstPage does on every merge.
        $pdf = new Fpdi('P', 'mm');
        $pages = $pdf->setSourceFile($path);
        $this->assertSame(1, $pages);
        $this->assertNotEmpty($pdf->importPage(1));
    }

    private function writePng(string $name, int $width, int $height): string
    {
        $path = $this->workdir.'/'.$name;
        $image = imagecreatetruecolor($width, $height);
        imagefill($image, 0, 0, imagecolorallocate($image, 255, 255, 255));
        imagefilledellipse(
            $image,
            (int) ($width / 2),
            (int) ($height / 2),
            (int) ($width * 0.6),
            (int) ($height * 0.6),
            imagecolorallocate($image, 20, 35, 65),
        );
        imagepng($image, $path, 9);
        imagedestroy($image);

        return $path;
    }

    /**
     * A photographic scan: dense detail in every pixel, which is what a 300 DPI
     * flatbed actually produces and what downsampling reliably shrinks.
     */
    private function writeScan(string $name, int $width, int $height): string
    {
        $path = $this->workdir.'/'.$name;
        $image = imagecreatetruecolor($width, $height);

        // Coarse blocks rather than per-pixel writes — 8.7M imagesetpixel calls is
        // several seconds of test time for no extra fidelity.
        for ($x = 0; $x < $width; $x += 4) {
            for ($y = 0; $y < $height; $y += 4) {
                $shade = (int) (127 + 100 * sin($x / 90) * cos($y / 70)) + random_int(-35, 35);
                $shade = max(0, min(255, $shade));
                imagefilledrectangle(
                    $image, $x, $y, $x + 3, $y + 3,
                    imagecolorallocate($image, $shade, $shade, max(0, $shade - 12)),
                );
            }
        }

        imagejpeg($image, $path, 100);
        imagedestroy($image);

        return $path;
    }

    /** An A4 PDF carrying a 300 DPI photographic image — the client's letterhead in miniature. */
    private function writeImageHeavyPdf(string $name): string
    {
        $jpeg = $this->workdir.'/inner.jpg';
        $image = imagecreatetruecolor(2480, 3507);

        for ($i = 0; $i < 200000; $i++) {
            imagesetpixel(
                $image,
                random_int(0, 2479),
                random_int(0, 3506),
                imagecolorallocate($image, random_int(0, 255), random_int(0, 255), random_int(0, 255)),
            );
        }

        imagejpeg($image, $jpeg, 100);
        imagedestroy($image);

        $path = $this->workdir.'/'.$name;
        $pdf = new Fpdi('P', 'mm', 'A4');
        $pdf->setPrintHeader(false);
        $pdf->setPrintFooter(false);
        $pdf->AddPage();
        $pdf->Image($jpeg, 0, 0, 210, 297);
        $pdf->Output($path, 'F');
        @unlink($jpeg);

        return $path;
    }
}
