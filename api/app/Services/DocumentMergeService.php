<?php

namespace App\Services;

use App\Models\LetterheadTemplate;
use App\Support\PlacementConfig;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use setasign\Fpdi\Tcpdf\Fpdi;

/**
 * M9b — the letterhead + stamp merge (the 11k EGP contract item).
 *
 * Pipeline: deliverable → PDF (Gotenberg/LibreOffice) → FPDI re-draw, page by page:
 *
 *   1. letterhead (background layer) — full page, under everything
 *   2. the deliverable page itself, scaled into the letterhead's content band so
 *      translated text can never land on the header/footer artwork
 *   3. stamp (foreground layer) — over the text, at its configured anchor
 *
 * Geometry is physical millimetres from the page's top-left corner throughout
 * (App\Support\PlacementConfig), never RTL-relative — a stamp anchored bottom-right
 * sits bottom-right on an Arabic page exactly as it does on an English one.
 */
class DocumentMergeService
{
    /** LibreOffice handles these; anything else is expected to be a PDF already. */
    private const CONVERTIBLE = ['doc', 'docx', 'odt', 'rtf', 'txt', 'xls', 'xlsx', 'ppt', 'pptx'];

    private const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg'];

    /**
     * Convert a stored document to PDF, returning an absolute temp path.
     *
     * PDFs are passed through untouched — re-rendering a PDF through LibreOffice
     * rasterises Arabic shaping and loses text selection.
     */
    public function toPdf(string $diskPath, string $originalName): string
    {
        $extension = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
        $contents = Storage::disk('local')->get($diskPath);

        if ($contents === null) {
            throw new RuntimeException("Deliverable missing from storage: {$diskPath}");
        }

        if ($extension === 'pdf') {
            return $this->writeTemp($contents, 'pdf');
        }

        if (in_array($extension, self::IMAGE_EXTENSIONS, true)) {
            return $this->imageToPdf($contents, $extension);
        }

        if (! in_array($extension, self::CONVERTIBLE, true)) {
            throw new RuntimeException("Cannot convert .{$extension} to PDF for merging.");
        }

        $response = Http::timeout(120)
            ->attach('files', $contents, $originalName)
            ->post(config('services.gotenberg.url').'/forms/libreoffice/convert', [
                'losslessImageCompression' => 'true',
            ])
            ->throw();

        return $this->writeTemp($response->body(), 'pdf');
    }

    /**
     * Draw the letterhead and stamp onto every page of $pdfPath.
     *
     * @param  string  $pdfPath  absolute path to the source PDF
     * @return string binary PDF
     */
    public function merge(string $pdfPath, ?LetterheadTemplate $letterhead, ?LetterheadTemplate $stamp): string
    {
        $pdf = new Fpdi('P', 'mm');
        $pdf->setPrintHeader(false);
        $pdf->setPrintFooter(false);
        $pdf->SetAutoPageBreak(false);
        $pdf->SetMargins(0, 0, 0);
        $pdf->setCreator('Bahr Al-Maaani');

        $letterheadPlacement = $letterhead
            ? PlacementConfig::normalize($letterhead->placement, $letterhead->kind)
            : null;
        $stampPlacement = $stamp
            ? PlacementConfig::normalize($stamp->placement, $stamp->kind)
            : null;

        // Imported templates stay valid after the source file switches, so the
        // letterhead is read once here rather than per page.
        $letterheadTemplate = $letterhead && ! $letterhead->isImage()
            ? $this->importFirstPage($pdf, $letterhead)
            : null;

        $pageCount = $pdf->setSourceFile($pdfPath);

        for ($page = 1; $page <= $pageCount; $page++) {
            $imported = $pdf->importPage($page);
            $size = $pdf->getTemplateSize($imported);
            [$width, $height] = [$size['width'], $size['height']];

            $pdf->AddPage($size['orientation'], [$width, $height]);

            if ($letterhead && $this->appliesToPage($letterheadPlacement['pages'], $page, $pageCount)) {
                $this->draw($pdf, $letterhead, $letterheadPlacement, $letterheadTemplate, $width, $height);
            }

            $content = PlacementConfig::resolveContentRect($letterheadPlacement, $width, $height);
            $pdf->useTemplate($imported, $content['x'], $content['y'], $content['width'], $content['height']);

            if ($stamp && $this->appliesToPage($stampPlacement['pages'], $page, $pageCount)) {
                $this->draw($pdf, $stamp, $stampPlacement, null, $width, $height);
            }
        }

        return $pdf->Output('', 'S');
    }

    /** Convenience wrapper: convert then merge, cleaning up the intermediate file. */
    public function mergeStoredFile(
        string $diskPath,
        string $originalName,
        ?LetterheadTemplate $letterhead,
        ?LetterheadTemplate $stamp,
    ): string {
        $pdfPath = $this->toPdf($diskPath, $originalName);

        try {
            return $this->merge($pdfPath, $letterhead, $stamp);
        } finally {
            @unlink($pdfPath);
        }
    }

    /** Draw one template at its placement rectangle, honouring opacity. */
    private function draw(
        Fpdi $pdf,
        LetterheadTemplate $template,
        array $placement,
        mixed $importedTemplate,
        float $pageWidth,
        float $pageHeight,
    ): void {
        $ratio = $this->assetRatio($pdf, $template, $importedTemplate);
        $rect = PlacementConfig::resolveRect($placement, $pageWidth, $pageHeight, $ratio);

        $opacity = $placement['opacity'];

        if ($opacity < 1.0) {
            $pdf->SetAlpha($opacity);
        }

        if ($importedTemplate !== null) {
            $pdf->useTemplate($importedTemplate, $rect['x'], $rect['y'], $rect['width'], $rect['height']);
        } else {
            $path = Storage::disk('local')->path($template->disk_path);

            // resize=false + dpi hint keeps the 300dpi stamp crisp instead of
            // letting TCPDF downsample it to the rendered box.
            $pdf->Image(
                $path,
                $rect['x'],
                $rect['y'],
                $rect['width'],
                $rect['height'],
                '',
                '',
                '',
                false,
                300,
                '',
                false,
                false,
                0,
            );
        }

        if ($opacity < 1.0) {
            $pdf->SetAlpha(1.0);
        }
    }

    /** Asset height ÷ width — drives the rectangle PlacementConfig resolves. */
    private function assetRatio(Fpdi $pdf, LetterheadTemplate $template, mixed $importedTemplate): float
    {
        if ($importedTemplate !== null) {
            $size = $pdf->getTemplateSize($importedTemplate);

            return $size['height'] / $size['width'];
        }

        $dimensions = @getimagesize(Storage::disk('local')->path($template->disk_path));

        if ($dimensions === false || (int) $dimensions[0] === 0) {
            throw new RuntimeException("Unreadable template asset: {$template->disk_path}");
        }

        return $dimensions[1] / $dimensions[0];
    }

    /** PDF-backed templates are imported; the handle is reused on every page. */
    private function importFirstPage(Fpdi $pdf, LetterheadTemplate $template): mixed
    {
        $absolute = Storage::disk('local')->path($template->disk_path);

        if (! is_file($absolute)) {
            throw new RuntimeException("Template asset missing from storage: {$template->disk_path}");
        }

        $pdf->setSourceFile($absolute);

        return $pdf->importPage(1);
    }

    private function appliesToPage(string $pages, int $page, int $pageCount): bool
    {
        return match ($pages) {
            'first' => $page === 1,
            'last' => $page === $pageCount,
            default => true,
        };
    }

    /**
     * A two-page Arabic specimen for `POST /letterheads/{id}/preview`.
     *
     * Two pages so `pages: first|last` placements are visibly different, and ruled
     * lines rather than prose so the eye lands on geometry, not wording.
     *
     * @return string absolute temp path
     */
    public function specimenPdf(): string
    {
        $pdf = new Fpdi('P', 'mm', 'A4');
        $pdf->setPrintHeader(false);
        $pdf->setPrintFooter(false);
        $pdf->SetAutoPageBreak(false);
        $pdf->SetMargins(20, 20, 20);
        $pdf->setRTL(true);
        $pdf->SetFont('dejavusans', '', 12);

        foreach (['الصفحة الأولى — نموذج معاينة', 'الصفحة الأخيرة — نموذج معاينة'] as $index => $heading) {
            $pdf->AddPage();
            $pdf->SetY(20);
            $pdf->SetFont('dejavusans', 'B', 14);
            $pdf->Cell(0, 10, $heading, 0, 1, 'R');
            $pdf->SetFont('dejavusans', '', 11);
            $pdf->Ln(4);

            for ($line = 1; $line <= 24; $line++) {
                $pdf->Cell(0, 8, "سطر تجريبي رقم {$line} — نص لقياس موضع الترويسة والختم.", 0, 1, 'R');
            }

            $pdf->Ln(6);
            $pdf->Cell(0, 8, $index === 0 ? 'يتبع…' : 'المترجم المعتمد: ____________________', 0, 1, 'R');
        }

        return $this->writeTemp($pdf->Output('', 'S'), 'pdf');
    }

    /** A scanned deliverable becomes a single A4 page sized to the image's aspect. */
    private function imageToPdf(string $contents, string $extension): string
    {
        $source = $this->writeTemp($contents, $extension);

        try {
            $dimensions = @getimagesize($source);

            if ($dimensions === false || (int) $dimensions[0] === 0) {
                throw new RuntimeException('Deliverable image could not be read.');
            }

            $pdf = new Fpdi('P', 'mm', 'A4');
            $pdf->setPrintHeader(false);
            $pdf->setPrintFooter(false);
            $pdf->SetAutoPageBreak(false);
            $pdf->SetMargins(0, 0, 0);
            $pdf->AddPage();

            // Fit inside A4 without distorting the scan.
            $ratio = $dimensions[1] / $dimensions[0];
            $width = 210.0;
            $height = $width * $ratio;

            if ($height > 297.0) {
                $height = 297.0;
                $width = $height / $ratio;
            }

            $pdf->Image($source, (210.0 - $width) / 2, (297.0 - $height) / 2, $width, $height);

            return $this->writeTemp($pdf->Output('', 'S'), 'pdf');
        } finally {
            @unlink($source);
        }
    }

    private function writeTemp(string $contents, string $extension): string
    {
        $path = tempnam(sys_get_temp_dir(), 'bahr-merge-').'.'.$extension;
        file_put_contents($path, $contents);

        return $path;
    }

    /** @return list<string> extensions the merge pipeline accepts as a deliverable */
    public static function supportedExtensions(): array
    {
        return array_merge(['pdf'], self::CONVERTIBLE, self::IMAGE_EXTENSIONS);
    }
}
