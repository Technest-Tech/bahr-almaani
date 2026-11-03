<?php

namespace Tests\Unit;

use App\Support\DocxRtlDates;
use PHPUnit\Framework\TestCase;
use ZipArchive;

/**
 * A date in an Arabic run must come out of LibreOffice the way Word shows it:
 * «10/08/2026» typed, 2026/08/10 on the page (BM-2026-00600).
 */
class DocxRtlDatesTest extends TestCase
{
    private const RLM = "\u{200F}";

    public function test_a_date_in_a_right_to_left_run_gets_its_slashes_marked(): void
    {
        $docx = $this->docx($this->textRun('تاريخ الفاتورة: 10/08/2026', rtl: true));

        $this->assertStringContainsString(
            '10'.self::RLM.'/'.self::RLM.'08'.self::RLM.'/'.self::RLM.'2026',
            $this->part(DocxRtlDates::apply($docx)),
        );
    }

    public function test_a_left_to_right_run_is_left_alone(): void
    {
        $this->assertNull(DocxRtlDates::apply($this->docx($this->textRun('Invoice date: 10/08/2026', rtl: false))));
    }

    /** Word leaves these in reading order, so LibreOffice already agrees with it. */
    public function test_decimals_and_thousands_are_left_alone(): void
    {
        $this->assertNull(DocxRtlDates::apply($this->docx($this->textRun('الكمية: 29.700 الإجمالي: 920,700', rtl: true))));
    }

    /** Word splits runs wherever an edit happened; the date still has to read right. */
    public function test_a_date_split_across_runs_is_marked_in_both(): void
    {
        $xml = $this->part(DocxRtlDates::apply($this->docx(
            $this->textRun('التاريخ: 10/', rtl: true).$this->textRun('08/2026', rtl: true),
        )));

        $this->assertStringContainsString('10'.self::RLM.'/'.self::RLM.'</w:t>', $xml);
        $this->assertStringContainsString('08'.self::RLM.'/'.self::RLM.'2026', $xml);
    }

    public function test_an_explicitly_left_to_right_run_is_left_alone(): void
    {
        $run = '<w:r><w:rPr><w:rtl w:val="0"/></w:rPr><w:t>10/08/2026</w:t></w:r>';

        $this->assertNull(DocxRtlDates::apply($this->docx($run)));
    }

    public function test_headers_are_marked_too(): void
    {
        $docx = $this->docx($this->textRun('بدون تاريخ', rtl: true), [
            'word/header1.xml' => '<w:hdr><w:p>'.$this->textRun('صدر في 01/02/2026', rtl: true).'</w:p></w:hdr>',
        ]);

        $this->assertStringContainsString(
            '01'.self::RLM.'/'.self::RLM.'02',
            $this->part(DocxRtlDates::apply($docx), 'word/header1.xml'),
        );
    }

    public function test_marking_twice_changes_nothing_more(): void
    {
        $once = DocxRtlDates::apply($this->docx($this->textRun('10/08/2026', rtl: true)));

        $this->assertNull(DocxRtlDates::apply((string) $once));
    }

    public function test_bytes_that_are_not_a_docx_are_refused_quietly(): void
    {
        $this->assertNull(DocxRtlDates::apply('not a zip'));
    }

    private function textRun(string $text, bool $rtl): string
    {
        $properties = $rtl ? '<w:rPr><w:sz w:val="24"/><w:rtl/></w:rPr>' : '<w:rPr><w:sz w:val="24"/></w:rPr>';

        return '<w:r w:rsidRPr="00665283">'.$properties.'<w:t xml:space="preserve">'.$text.'</w:t></w:r>';
    }

    /** @param  array<string, string>  $extraParts */
    private function docx(string $runs, array $extraParts = []): string
    {
        $path = tempnam(sys_get_temp_dir(), 'bahr-docx-test-').'.docx';
        $zip = new ZipArchive;
        $zip->open($path, ZipArchive::OVERWRITE | ZipArchive::CREATE);
        $zip->addFromString('[Content_Types].xml', '<?xml version="1.0"?><Types/>');
        $zip->addFromString(
            'word/document.xml',
            '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            .'<w:body><w:p><w:pPr><w:bidi/><w:rPr><w:rtl/></w:rPr></w:pPr>'.$runs.'</w:p></w:body></w:document>'
        );

        foreach ($extraParts as $name => $xml) {
            $zip->addFromString($name, $xml);
        }

        $zip->close();

        $bytes = (string) file_get_contents($path);
        @unlink($path);

        return $bytes;
    }

    private function part(?string $docx, string $name = 'word/document.xml'): string
    {
        $this->assertNotNull($docx, 'Expected the document to be rewritten.');

        $path = tempnam(sys_get_temp_dir(), 'bahr-docx-test-').'.docx';
        file_put_contents($path, $docx);
        $zip = new ZipArchive;
        $zip->open($path);
        $xml = (string) $zip->getFromName($name);
        $zip->close();
        @unlink($path);

        return $xml;
    }
}
