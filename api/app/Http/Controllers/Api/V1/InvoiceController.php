<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\InvoiceResource;
use App\Models\Invoice;
use App\Models\Project;
use App\Services\InvoiceNumberGenerator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\View;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Client invoicing (change request agreed 2026-09-05).
 *
 * The office's flow, verbatim: choose the client, the system brings the page
 * count itself, type the price, the invoice comes out. "The page count" is the
 * delivered basis that reports use — the certified file's pages — with source
 * pages standing in for history that predates delivered totals.
 */
class InvoiceController extends Controller
{
    /** Statuses whose work is finished and therefore billable. */
    private const BILLABLE_STATUSES = [Project::STATUS_COMPLETED, Project::STATUS_ARCHIVED];

    public function index(Request $request): AnonymousResourceCollection
    {
        return InvoiceResource::collection(
            Invoice::query()
                ->with('client:id,name')
                ->when($request->integer('client_id'), fn ($q, $id) => $q->where('client_id', $id))
                ->latest('issued_at')
                ->paginate(min($request->integer('per_page', 15), 100)),
        );
    }

    /**
     * The client's finished, not-yet-invoiced projects — what a new invoice
     * can bill. Pages and words arrive already on the delivered basis, so the
     * dialog shows the exact numbers the invoice will carry.
     */
    public function billable(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'client_id' => ['required', 'integer', 'exists:clients,id'],
        ]);

        $projects = Project::query()
            ->where('client_id', $validated['client_id'])
            ->whereIn('status', self::BILLABLE_STATUSES)
            ->whereNull('invoice_id')
            ->orderByDesc('completed_at')
            ->get();

        return response()->json([
            'data' => $projects->map(fn (Project $project): array => [
                'id' => $project->id,
                'code' => $project->code,
                'title' => $project->title,
                'pages' => $project->delivered_pages ?? $project->total_pages,
                'words' => $project->delivered_words ?? $project->total_words,
                'completed_at' => $project->completed_at?->toIso8601String(),
            ])->values(),
        ]);
    }

    public function store(Request $request, InvoiceNumberGenerator $numbers): InvoiceResource
    {
        $validated = $request->validate([
            'client_id' => ['required', 'integer', 'exists:clients,id'],
            'project_ids' => ['required', 'array', 'min:1', 'max:100'],
            'project_ids.*' => ['integer', 'distinct'],
            // Either a per-page rate (amount is computed) or a typed total.
            'unit_price' => ['nullable', 'numeric', 'min:0', 'max:1000000', 'required_without:amount'],
            'amount' => ['nullable', 'numeric', 'min:0', 'max:100000000', 'required_without:unit_price'],
            'currency' => ['nullable', 'string', 'size:3', 'alpha'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ]);

        $invoice = DB::transaction(function () use ($validated, $request, $numbers): Invoice {
            // Locked so two windows cannot bill the same project at once: the
            // second transaction waits here, then fails the invoice_id check.
            $projects = Project::query()
                ->whereKey($validated['project_ids'])
                ->where('client_id', $validated['client_id'])
                ->whereIn('status', self::BILLABLE_STATUSES)
                ->whereNull('invoice_id')
                ->lockForUpdate()
                ->get();

            abort_unless(
                $projects->count() === count($validated['project_ids']),
                422,
                'بعض المشاريع المحددة لم تعد قابلة للفوترة — ربما فُوترت من نافذة أخرى. حدّث القائمة وحاول مجدداً.',
            );

            $pages = (int) $projects->sum(fn (Project $p) => $p->delivered_pages ?? $p->total_pages ?? 0);
            $words = (int) $projects->sum(fn (Project $p) => $p->delivered_words ?? $p->total_words ?? 0);

            abort_unless($pages > 0, 422, 'لا يوجد عدد صفحات لهذه المشاريع — أدخل العدد يدوياً على ملفاتها أولاً.');

            $unitPrice = isset($validated['unit_price']) ? round((float) $validated['unit_price'], 2) : null;
            $amount = isset($validated['amount'])
                ? round((float) $validated['amount'], 2)
                : round($pages * $unitPrice, 2);

            $invoice = Invoice::create([
                'number' => $numbers->next(),
                'client_id' => $validated['client_id'],
                'total_pages' => $pages,
                'total_words' => $words ?: null,
                'unit_price' => $unitPrice,
                'amount' => $amount,
                'currency' => strtoupper($validated['currency'] ?? 'EGP'),
                'notes' => $validated['notes'] ?? null,
                // Snapshot, not references: the printed rows must never follow
                // later edits to the projects.
                'line_items' => $projects->map(fn (Project $p): array => [
                    'project_id' => $p->id,
                    'code' => $p->code,
                    'title' => $p->title,
                    'pages' => $p->delivered_pages ?? $p->total_pages,
                    'words' => $p->delivered_words ?? $p->total_words,
                ])->values()->all(),
                'created_by' => $request->user()->id,
                'issued_at' => now(),
            ]);

            Project::whereKey($projects->pluck('id'))->update(['invoice_id' => $invoice->id]);

            // Rendered inside the transaction so a Gotenberg failure rolls the
            // whole issue back — an invoice with no document helps nobody. The
            // burned number is the accepted cost (see InvoiceNumberGenerator).
            $path = "invoices/{$invoice->id}.pdf";
            Storage::disk('local')->put($path, $this->renderPdf($invoice->fresh(['client', 'creator'])));
            $invoice->update(['disk_path' => $path]);

            return $invoice;
        });

        return InvoiceResource::make($invoice->load('client'));
    }

    public function show(Invoice $invoice): InvoiceResource
    {
        return InvoiceResource::make($invoice->load(['client', 'creator']));
    }

    public function download(Invoice $invoice): StreamedResponse
    {
        abort_unless($invoice->disk_path && Storage::disk('local')->exists($invoice->disk_path), 404);

        return Storage::disk('local')->download($invoice->disk_path, "{$invoice->number}.pdf");
    }

    /** Same Blade → Gotenberg pipeline as the report exports. */
    private function renderPdf(Invoice $invoice): string
    {
        $html = View::make('invoices.show', ['invoice' => $invoice])->render();

        return Http::timeout(60)
            ->attach('files', $html, 'index.html')
            ->post(config('services.gotenberg.url').'/forms/chromium/convert/html', [
                'paperWidth' => '8.27',   // A4
                'paperHeight' => '11.7',
                'marginTop' => '0.4',
                'marginBottom' => '0.4',
            ])
            ->throw()
            ->body();
    }
}
