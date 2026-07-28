<?php

namespace Tests\Concerns;

use Illuminate\Support\Facades\Http;
use setasign\Fpdi\Tcpdf\Fpdi;

/**
 * Keeps the merge pipeline hermetic.
 *
 * `DocumentMergeService::toPdf()` sends non-PDF deliverables to Gotenberg, which CI
 * does not run (only Postgres is a service container). Faking the endpoint with a
 * genuine PDF body keeps the FPDI half of the pipeline under real test — a stub of
 * random bytes would just make FPDI throw.
 */
trait FakesDocumentConversion
{
    /** How many pages the faked converter returns; read at request time. */
    protected int $conversionPageCount = 1;

    /**
     * Laravel merges successive Http::fake() calls and the first match wins, so the
     * body is resolved from this property rather than captured — otherwise a stub
     * registered in setUp() would shadow a later per-test override.
     */
    protected function fakeGotenberg(int $pages = 1): void
    {
        $this->conversionPageCount = $pages;

        Http::fake([
            '*/forms/libreoffice/convert' => fn () => Http::response(
                $this->samplePdf($this->conversionPageCount),
                200,
                ['Content-Type' => 'application/pdf'],
            ),
        ]);
    }

    /** A real, parsable A4 PDF with Arabic text on every page. */
    protected function samplePdf(int $pages = 1): string
    {
        $pdf = new Fpdi('P', 'mm', 'A4');
        $pdf->setPrintHeader(false);
        $pdf->setPrintFooter(false);
        $pdf->SetAutoPageBreak(false);
        $pdf->setRTL(true);
        $pdf->SetFont('dejavusans', '', 12);

        for ($page = 1; $page <= $pages; $page++) {
            $pdf->AddPage();
            $pdf->SetY(40);
            $pdf->Cell(0, 10, "صفحة الترجمة رقم {$page}", 0, 1, 'R');
        }

        return $pdf->Output('', 'S');
    }
}
