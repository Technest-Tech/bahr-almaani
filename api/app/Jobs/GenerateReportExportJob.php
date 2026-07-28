<?php

namespace App\Jobs;

use App\Models\ReportExport;
use App\Notifications\ReportReadyNotification;
use App\Services\ReportService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\View;
use OpenSpout\Common\Entity\Row;
use OpenSpout\Writer\XLSX\Entity\SheetView;
use OpenSpout\Writer\XLSX\Options;
use OpenSpout\Writer\XLSX\Writer;

class GenerateReportExportJob implements ShouldQueue
{
    use Queueable;

    public int $timeout = 120;

    public function __construct(public ReportExport $export) {}

    public function handle(ReportService $reports): void
    {
        $this->export->update(['status' => ReportExport::STATUS_PROCESSING]);

        try {
            $report = $reports->build($this->export->report_type, $this->export->params ?? []);

            $path = $this->export->format === 'pdf'
                ? $this->writePdf($report)
                : $this->writeXlsx($report);

            $this->export->update(['status' => ReportExport::STATUS_DONE, 'disk_path' => $path]);
            $this->export->user->notify(new ReportReadyNotification($this->export));
        } catch (\Throwable $e) {
            $this->export->update(['status' => ReportExport::STATUS_FAILED, 'error' => $e->getMessage()]);
            throw $e;
        }
    }

    private function writeXlsx(array $report): string
    {
        $path = "reports/{$this->export->id}.xlsx";
        Storage::disk('local')->makeDirectory('reports');
        $absolute = Storage::disk('local')->path($path);

        $options = new Options;
        $options->setColumnWidth(22, ...range(1, count($report['columns'])));

        $writer = new Writer($options);
        $writer->openToFile($absolute);
        $writer->getCurrentSheet()->setSheetView((new SheetView)->setRightToLeft(true));
        $writer->addRow(Row::fromValues(array_values($report['columns'])));

        foreach ($report['rows'] as $row) {
            // Keep column order identical to the header row.
            $writer->addRow(Row::fromValues(array_map(
                fn (string $key) => $row[$key] ?? '',
                array_keys($report['columns']),
            )));
        }

        $writer->close();

        return $path;
    }

    private function writePdf(array $report): string
    {
        $html = View::make('reports.export', [
            'title' => __("reports.{$this->export->report_type}"),
            'columns' => $report['columns'],
            'rows' => $report['rows'],
            'params' => $this->export->params ?? [],
            'generatedAt' => now(),
        ])->render();

        $response = Http::timeout(60)
            ->attach('files', $html, 'index.html')
            ->post(config('services.gotenberg.url').'/forms/chromium/convert/html', [
                'paperWidth' => '8.27',   // A4
                'paperHeight' => '11.7',
                'marginTop' => '0.4',
                'marginBottom' => '0.4',
            ])
            ->throw();

        $path = "reports/{$this->export->id}.pdf";
        Storage::disk('local')->put($path, $response->body());

        return $path;
    }
}
