<?php

namespace App\Services;

use App\Models\LetterheadTemplate;
use App\Support\AssetOptimizer;
use App\Support\DocxPageMargins;
use App\Support\Ghostscript;
use App\Support\PlacementConfig;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;
use setasign\Fpdi\Tcpdf\Fpdi;
use Throwable;

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
        return $this->convert($diskPath, $originalName, null)['path'];
    }

    /**
     * Convert, reserving the letterhead's content band in the document's own layout
     * where the format allows it.
     *
     * A .docx carries its page geometry, so widening `<w:pgMar>` before handing it to
     * LibreOffice makes the translation reflow *into* the band at full size — the fix
     * for pages that used to arrive shrunk to 80% with blank gutters down both sides.
     * Everything else (a ready-made PDF, a scan, .rtf, .xlsx) has no geometry we can
     * safely rewrite and falls back to `PlacementConfig::resolveContentRect()`.
     *
     * @param  array{top: float, bottom: float}|null  $band  from PlacementConfig::band()
     * @return array{path: string, reserved: bool} `reserved` tells merge() the page is
     *                                             already clear of the artwork
     */
    private function convert(string $diskPath, string $originalName, ?array $band): array
    {
        $extension = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
        $contents = Storage::disk('local')->get($diskPath);

        if ($contents === null) {
            throw new RuntimeException("Deliverable missing from storage: {$diskPath}");
        }

        if ($extension === 'pdf') {
            return ['path' => $this->ensureFpdiReadable($this->writeTemp($contents, 'pdf')), 'reserved' => false];
        }

        if (in_array($extension, self::IMAGE_EXTENSIONS, true)) {
            return ['path' => $this->imageToPdf($contents, $extension), 'reserved' => false];
        }

        if (! in_array($extension, self::CONVERTIBLE, true)) {
            throw new RuntimeException("Cannot convert .{$extension} to PDF for merging.");
        }

        $reserved = false;

        if ($band !== null && $extension === 'docx') {
            $widened = DocxPageMargins::reserve($contents, $band['top'], $band['bottom']);

            if ($widened !== null) {
                $contents = $widened;
                $reserved = true;
            } else {
                Log::info('Deliverable margins could not be widened; falling back to scaling the page', [
                    'name' => $originalName,
                ]);
            }
        }

        $response = Http::timeout(120)
            ->attach('files', $contents, $originalName)
            ->post(config('services.gotenberg.url').'/forms/libreoffice/convert', [
                'losslessImageCompression' => 'true',
            ])
            ->throw();

        return [
            'path' => $this->ensureFpdiReadable($this->writeTemp($response->body(), 'pdf')),
            'reserved' => $reserved,
        ];
    }

    /**
     * Hand back a PDF that FPDI can actually open.
     *
     * FPDI 2.x free has no reader for object streams or compressed cross-reference
     * tables, so a deliverable saved by a recent Word, Acrobat or scanner app throws
     * "This PDF document probably uses a compression technique which is not supported
     * by the free parser shipped with FPDI" and the merge fails — the project stays
     * `approved`, the PM gets a failure mail and there is no final file to download.
     * That is what happened to BM-2026-00006 in production.
     *
     * Parsing is attempted first so a PDF that already works costs nothing; only a
     * file that genuinely cannot be opened is rewritten. If ghostscript is missing or
     * the rewrite fails the original path is returned unchanged, and the merge fails
     * exactly as it did before — no new failure mode.
     */
    private function ensureFpdiReadable(string $path): string
    {
        try {
            (new Fpdi)->setSourceFile($path);

            return $path;
        } catch (Throwable $e) {
            $repaired = AssetOptimizer::normalizeToPdf14($path);

            if ($repaired === null) {
                Log::warning('Deliverable is unreadable by FPDI and could not be normalised', [
                    'error' => $e->getMessage(),
                ]);

                return $path;
            }

            file_put_contents($path, $repaired);

            Log::info('Deliverable rewritten as PDF 1.4 so the merge could read it', [
                'reason' => Str::limit($e->getMessage(), 120),
            ]);

            return $path;
        }
    }

    /**
     * Draw the letterhead and stamp onto every page of $pdfPath.
     *
     * @param  string  $pdfPath  absolute path to the source PDF
     * @param  string|null  $watermark  stamped diagonally across every page when set.
     *                                  Only the translator's draft preview passes this;
     *                                  the approved final file must never carry one, so
     *                                  it defaults to null and the merge path the
     *                                  MergeFinalFileJob uses is byte-for-byte unchanged.
     * @param  bool  $bandReservedInLayout  the deliverable was converted with the band
     *                                      already reserved in its own page margins, so
     *                                      its pages must be drawn at full size — see
     *                                      convert() and App\Support\DocxPageMargins
     * @param  array|null  $stampPlacement  this document's own stamp position, overriding
     *                                      the template's. Null keeps the template's, so
     *                                      a file that never placed one is unchanged.
     *                                      The letterhead has no equivalent on purpose:
     *                                      it is the office's fixed stationery, and a
     *                                      per-document one would be a different template.
     * @return string binary PDF
     */
    public function merge(
        string $pdfPath,
        ?LetterheadTemplate $letterhead,
        ?LetterheadTemplate $stamp,
        ?string $watermark = null,
        bool $bandReservedInLayout = false,
        ?array $stampPlacement = null,
    ): string {
        $pdf = new Fpdi('P', 'mm');
        $pdf->setPrintHeader(false);
        $pdf->setPrintFooter(false);
        $pdf->SetAutoPageBreak(false);
        $pdf->SetMargins(0, 0, 0);
        $pdf->setCreator('Bahr Al-Maaani');

        $letterheadPlacement = $letterhead
            ? PlacementConfig::normalize($letterhead->placement, $letterhead->kind)
            : null;
        // The project's own placement wins when it has one; normalize() fills whatever
        // the translator's drag did not set from the template's value, so a position
        // carrying only x/y still keeps the stamp's true physical width.
        $stampPlacement = $stamp
            ? PlacementConfig::normalize(
                $stampPlacement ?? $stamp->placement,
                $stamp->kind,
                $stampPlacement !== null ? PlacementConfig::normalize($stamp->placement, $stamp->kind) : null,
            )
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

            $carriesLetterhead = $letterhead
                && $this->appliesToPage($letterheadPlacement['pages'], $page, $pageCount);

            if ($carriesLetterhead) {
                $this->draw($pdf, $letterhead, $letterheadPlacement, $letterheadTemplate, $width, $height);
            }

            // Only a page that actually carries the artwork has anything to dodge, and
            // a page whose text was already laid out inside the band must not be
            // shrunk into it a second time. Both used to shrink regardless: on a
            // `pages: first` letterhead every page after the first came out at 80%
            // with blank gutters, dodging artwork that was never drawn on it.
            $content = $carriesLetterhead && ! $bandReservedInLayout
                ? PlacementConfig::resolveContentRect($letterheadPlacement, $width, $height)
                : PlacementConfig::resolveContentRect(null, $width, $height);

            $pdf->useTemplate($imported, $content['x'], $content['y'], $content['width'], $content['height']);

            if ($stamp && $this->appliesToPage($stampPlacement['pages'], $page, $pageCount)) {
                $this->draw($pdf, $stamp, $stampPlacement, null, $width, $height);
            }

            // Last, so it sits over the stamp too — a draft has to stay obviously
            // a draft even on the page carrying the office's seal.
            if ($watermark !== null) {
                $this->drawWatermark($pdf, $watermark, $width, $height);
            }
        }

        return $pdf->Output('', 'S');
    }

    /**
     * Diagonal translucent text across the page.
     *
     * Deliberately hard to crop out or mistake for decoration: it crosses the
     * centre of the page, sits above the stamp, and repeats on every page.
     */
    private function drawWatermark(Fpdi $pdf, string $text, float $width, float $height): void
    {
        // The merge PDF is built LTR (it only ever placed images before), so an
        // Arabic watermark would come out with its words in reverse order. Flip
        // for the draw and put it back — the caller's pages must not inherit it.
        $rtl = $pdf->getRTL();
        $pdf->setRTL(true);

        $pdf->StartTransform();
        $pdf->SetAlpha(0.28);
        $pdf->SetTextColor(190, 30, 45);
        // Scale with the page so it spans A4 and a wide scan alike.
        $pdf->SetFont('dejavusans', 'B', max(28, min(64, $width / 6)));
        $pdf->Rotate(45, $width / 2, $height / 2);
        $pdf->SetXY(0, $height / 2 - 12);
        $pdf->Cell($width, 24, $text, 0, 0, 'C');
        $pdf->StopTransform();
        $pdf->SetAlpha(1);
        $pdf->SetTextColor(0, 0, 0);

        $pdf->setRTL($rtl);
    }

    /**
     * Convenience wrapper: convert then merge, cleaning up the intermediate file.
     *
     * The letterhead's content band is resolved here rather than inside merge(),
     * because the conversion is the only chance to reserve it in the document's own
     * layout — once LibreOffice has produced a page, the merge can do nothing but
     * scale it.
     */
    public function mergeStoredFile(
        string $diskPath,
        string $originalName,
        ?LetterheadTemplate $letterhead,
        ?LetterheadTemplate $stamp,
        ?string $watermark = null,
        ?array $stampPlacement = null,
    ): string {
        $placement = $letterhead
            ? PlacementConfig::normalize($letterhead->placement, $letterhead->kind)
            : null;

        // Widening the document's own margins moves every one of its pages, so it is
        // only the right trade when every page carries the artwork. A first/last-page
        // letterhead keeps the per-page fallback, which touches just those pages.
        $band = $placement !== null && $placement['pages'] === 'all'
            ? PlacementConfig::band($placement)
            : null;

        $converted = $this->convert($diskPath, $originalName, $band);

        try {
            return $this->merge(
                $converted['path'],
                $letterhead,
                $stamp,
                $watermark,
                $converted['reserved'],
                $stampPlacement,
            );
        } finally {
            @unlink($converted['path']);
        }
    }

    /**
     * The page a stamp is dragged onto, as a PNG plus its true physical size.
     *
     * It is deliberately the *converted, letterheaded* page rather than the file the
     * translator uploaded. A position is only meaningful against the geometry the merge
     * will actually produce, and two things move that geometry before the merge sees
     * it: LibreOffice repaginates a .docx, and (since the content band landed) the page
     * margins are widened first, which can push the last line onto a new page. Dragging
     * on the Word file would place the seal against a page that never exists.
     *
     * The stamp itself is NOT drawn — the browser overlays it as a draggable element, so
     * what comes back is the blank space the translator is choosing between.
     *
     * @param  int|null  $page  1-based; null means the last page, where a stamp goes
     * @return array{image: string, width_mm: float, height_mm: float, page: int, pages: int}
     *
     * @throws RuntimeException when ghostscript cannot render the page
     */
    public function stampSurface(
        string $diskPath,
        string $originalName,
        ?LetterheadTemplate $letterhead,
        ?int $page = null,
    ): array {
        $placement = $letterhead
            ? PlacementConfig::normalize($letterhead->placement, $letterhead->kind)
            : null;

        $band = $placement !== null && $placement['pages'] === 'all'
            ? PlacementConfig::band($placement)
            : null;

        $converted = $this->convert($diskPath, $originalName, $band);

        try {
            $merged = $this->writeTemp(
                $this->merge($converted['path'], $letterhead, null, null, $converted['reserved']),
                'pdf',
            );
        } finally {
            @unlink($converted['path']);
        }

        try {
            $pdf = new Fpdi;
            $pageCount = $pdf->setSourceFile($merged);
            $target = max(1, min($page ?? $pageCount, $pageCount));
            $size = $pdf->getTemplateSize($pdf->importPage($target));

            $image = Ghostscript::renderPage($merged, $target);

            if ($image === null) {
                throw new RuntimeException('Could not render the page the stamp is placed on.');
            }

            return [
                'image' => $image,
                'width_mm' => round($size['width'], 2),
                'height_mm' => round($size['height'], 2),
                'page' => $target,
                'pages' => $pageCount,
            ];
        } finally {
            @unlink($merged);
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
