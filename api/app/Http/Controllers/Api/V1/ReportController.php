<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Jobs\GenerateReportExportJob;
use App\Models\ReportExport;
use App\Services\ReportService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ReportController extends Controller
{
    public function __construct(
        private readonly ReportService $reports,
    ) {}

    /** On-screen report data (reports.view). */
    public function show(Request $request, string $type): JsonResponse
    {
        abort_unless(in_array($type, ReportService::TYPES, true), 404);

        $params = $request->validate([
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
            'status' => ['nullable', 'string'],
            'client_id' => ['nullable', 'integer'],
        ]);

        $report = $this->reports->build($type, $params);

        return response()->json(['data' => [
            'columns' => $report['columns'],
            'rows' => $report['rows'],
        ]]);
    }

    /** Queue an Excel/PDF export (reports.export); completion arrives on the bell. */
    public function export(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'report_type' => ['required', Rule::in(ReportService::TYPES)],
            'format' => ['required', Rule::in(['xlsx', 'pdf'])],
            'params' => ['nullable', 'array'],
            'params.from' => ['nullable', 'date'],
            'params.to' => ['nullable', 'date', 'after_or_equal:params.from'],
            'params.status' => ['nullable', 'string'],
            'params.client_id' => ['nullable', 'integer'],
        ]);

        $export = ReportExport::create([
            'user_id' => $request->user()->id,
            'report_type' => $validated['report_type'],
            'format' => $validated['format'],
            'params' => $validated['params'] ?? [],
            'status' => ReportExport::STATUS_QUEUED,
        ]);

        GenerateReportExportJob::dispatch($export);

        return response()->json([
            'data' => $this->present($export),
            'message' => __('reports.export_queued'),
        ], 202);
    }

    /** The caller's own exports, newest first. */
    public function exports(Request $request): JsonResponse
    {
        $exports = ReportExport::query()
            ->where('user_id', $request->user()->id)
            ->latest()
            ->limit(20)
            ->get();

        return response()->json(['data' => $exports->map(fn ($e) => $this->present($e))]);
    }

    /** Owner-only download of a finished export. */
    public function download(Request $request, ReportExport $export): StreamedResponse
    {
        abort_unless($export->user_id === $request->user()->id, 403);
        abort_unless($export->status === ReportExport::STATUS_DONE && $export->disk_path, 404, __('reports.export_not_ready'));

        $filename = __("reports.{$export->report_type}").'.'.$export->format;

        return Storage::disk('local')->download($export->disk_path, $filename);
    }

    private function present(ReportExport $export): array
    {
        return [
            'id' => $export->id,
            'report_type' => $export->report_type,
            'report_label' => __("reports.{$export->report_type}"),
            'format' => $export->format,
            'status' => $export->status,
            'params' => $export->params,
            'error' => $export->error,
            'created_at' => $export->created_at->toIso8601String(),
        ];
    }
}
