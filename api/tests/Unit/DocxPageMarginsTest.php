<?php

namespace Tests\Unit;

use App\Support\DocxPageMargins;
use PHPUnit\Framework\TestCase;
use ZipArchive;

/**
 * Reserving the letterhead band in a .docx's own page geometry, so LibreOffice lays
 * the translation out inside it instead of the merge shrinking a finished page in.
 */
class DocxPageMarginsTest extends TestCase
{
    /** 33mm at 1440 twips per inch. */
    private const TOP_TWIPS = 1871;

    /** 27mm. */
    private const BOTTOM_TWIPS = 1531;

    public function test_a_narrow_margin_is_widened_to_clear_the_artwork(): void
    {
        // 20mm top and bottom — Word's default-ish, and well inside a 33/27 band.
        $docx = $this->docx('<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/>');

        $margins = $this->marginsOf(DocxPageMargins::reserve($docx, 33.0, 27.0));

        $this->assertSame(self::TOP_TWIPS, $margins['top']);
        $this->assertSame(self::BOTTOM_TWIPS, $margins['bottom']);
        // Only the edges the letterhead occupies are touched.
        $this->assertSame(1134, $margins['left']);
        $this->assertSame(1134, $margins['right']);
    }

    /** Rule 1: a margin the translator set wider than the band is their choice. */
    public function test_a_margin_already_clear_of_the_band_is_left_alone(): void
    {
        $docx = $this->docx('<w:pgMar w:top="2880" w:right="1134" w:bottom="1134" w:left="1134"/>');

        $margins = $this->marginsOf(DocxPageMargins::reserve($docx, 33.0, 27.0));

        $this->assertSame(2880, $margins['top'], 'A 50mm top margin must not be narrowed to 33mm.');
        $this->assertSame(self::BOTTOM_TWIPS, $margins['bottom']);
    }

    /** Word allows a negative bottom margin; comparing numerically, not textually. */
    public function test_a_negative_margin_is_raised(): void
    {
        $docx = $this->docx('<w:pgMar w:top="1134" w:bottom="-283"/>');

        $this->assertSame(self::BOTTOM_TWIPS, $this->marginsOf(DocxPageMargins::reserve($docx, 33.0, 27.0))['bottom']);
    }

    public function test_a_missing_edge_is_added_rather_than_left_unreserved(): void
    {
        $docx = $this->docx('<w:pgMar w:right="1134" w:left="1134"/>');

        $margins = $this->marginsOf(DocxPageMargins::reserve($docx, 33.0, 27.0));

        $this->assertSame(self::TOP_TWIPS, $margins['top']);
        $this->assertSame(self::BOTTOM_TWIPS, $margins['bottom']);
    }

    /** A deliverable that changes page setup halfway through still needs every page clear. */
    public function test_every_section_is_reserved(): void
    {
        $docx = $this->docx(
            '<w:pgMar w:top="1134" w:bottom="1134"/>'
            .'<w:p/>'
            .'<w:pgMar w:top="567" w:bottom="567"/>'
        );

        $xml = $this->documentXml(DocxPageMargins::reserve($docx, 33.0, 27.0));

        $this->assertSame(2, substr_count($xml, 'w:top="'.self::TOP_TWIPS.'"'));
        $this->assertSame(2, substr_count($xml, 'w:bottom="'.self::BOTTOM_TWIPS.'"'));
    }

    /** Rule 2: an unusable input falls back to the shrink path, it does not blow up. */
    public function test_it_returns_null_rather_than_throwing_on_input_it_cannot_rewrite(): void
    {
        $this->assertNull(DocxPageMargins::reserve('not a zip at all', 33.0, 27.0));
        $this->assertNull(DocxPageMargins::reserve($this->docx('<w:p/>'), 33.0, 27.0), 'No page geometry to reserve.');
        $this->assertNull(DocxPageMargins::reserve($this->docx('<w:pgMar w:top="1134"/>'), 0.0, 0.0), 'No band configured.');
    }

    public function test_the_rest_of_the_package_survives_the_rewrite(): void
    {
        $docx = $this->docx('<w:pgMar w:top="1134" w:bottom="1134"/>');

        $path = $this->write(DocxPageMargins::reserve($docx, 33.0, 27.0));
        $zip = new ZipArchive;
        $zip->open($path);

        $this->assertNotFalse($zip->getFromName('[Content_Types].xml'), 'The rewrite must not drop other package parts.');
        $this->assertStringContainsString('صفحة الترجمة', (string) $zip->getFromName('word/document.xml'));

        $zip->close();
        @unlink($path);
    }

    /** A minimal but structurally real .docx wrapping $body inside the document part. */
    private function docx(string $body): string
    {
        $path = tempnam(sys_get_temp_dir(), 'bahr-docx-test-').'.docx';
        $zip = new ZipArchive;
        $zip->open($path, ZipArchive::OVERWRITE | ZipArchive::CREATE);
        $zip->addFromString('[Content_Types].xml', '<?xml version="1.0"?><Types/>');
        $zip->addFromString(
            'word/document.xml',
            '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            .'<w:body><w:p><w:r><w:t>صفحة الترجمة</w:t></w:r></w:p><w:sectPr>'.$body.'</w:sectPr></w:body></w:document>'
        );
        $zip->close();

        $bytes = (string) file_get_contents($path);
        @unlink($path);

        return $bytes;
    }

    /** @return array<string, int> the first `<w:pgMar>`'s attributes */
    private function marginsOf(?string $docx): array
    {
        $xml = $this->documentXml($docx);

        $this->assertMatchesRegularExpression('/<w:pgMar\b[^>]*>/', $xml);
        preg_match('/<w:pgMar\b[^>]*>/', $xml, $tag);
        preg_match_all('/\sw:(\w+)="(-?\d+)"/', $tag[0], $attributes, PREG_SET_ORDER);

        return array_reduce(
            $attributes,
            fn (array $carry, array $match): array => $carry + [$match[1] => (int) $match[2]],
            [],
        );
    }

    private function documentXml(?string $docx): string
    {
        $this->assertIsString($docx, 'Expected the rewrite to succeed.');

        $path = $this->write($docx);
        $zip = new ZipArchive;
        $zip->open($path);
        $xml = (string) $zip->getFromName('word/document.xml');
        $zip->close();
        @unlink($path);

        return $xml;
    }

    private function write(?string $docx): string
    {
        $path = tempnam(sys_get_temp_dir(), 'bahr-docx-out-').'.docx';
        file_put_contents($path, (string) $docx);

        return $path;
    }
}
