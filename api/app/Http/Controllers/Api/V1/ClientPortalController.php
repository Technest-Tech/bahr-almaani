<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\ClientAccountResource;
use App\Http\Resources\ClientProjectResource;
use App\Http\Resources\InvoiceResource;
use App\Models\Client;
use App\Models\Invoice;
use App\Models\Project;
use App\Models\ProjectFile;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * The client's own area on the website (M15): their profile, their projects,
 * their page counts and their invoices.
 *
 * Everything here is scoped to `auth('client')->user()` and nothing takes a client
 * id from the request — the signed-in row *is* the scope. Rows that belong to
 * someone else answer 404 rather than 403, so the ids cannot be probed.
 */
class ClientPortalController extends Controller
{
    /**
     * A draft is the office still assembling the record — no deadline committed,
     * often no files yet — so it stays internal until it is published.
     */
    private function visibleProjects(Client $client)
    {
        return Project::query()
            ->where('client_id', $client->id)
            ->where('status', '!=', Project::STATUS_DRAFT);
    }

    /** The dashboard of the client area: who they are, and their whole history in numbers. */
    public function overview(Request $request): JsonResponse
    {
        $client = $request->user();

        $byStage = $this->visibleProjects($client)
            ->select('status', DB::raw('COUNT(*) AS total'))
            ->groupBy('status')
            ->pluck('total', 'status');

        $stages = [];

        foreach ($byStage as $status => $total) {
            $stage = Project::CLIENT_STAGES[$status] ?? 'in_progress';
            $stages[$stage] = ($stages[$stage] ?? 0) + (int) $total;
        }

        // Pages first, on the delivered basis, with the source count standing in
        // for history that predates delivered totals — the same rule the invoices
        // and the reports use, so the three never disagree.
        $volume = $this->visibleProjects($client)
            ->selectRaw(
                'COALESCE(SUM(COALESCE(delivered_pages, total_pages)), 0) AS pages, '.
                'COALESCE(SUM(COALESCE(delivered_words, total_words)), 0) AS words'
            )
            ->first();

        $billing = Invoice::query()
            ->where('client_id', $client->id)
            ->select('currency', DB::raw('COUNT(*) AS invoices'), DB::raw('SUM(amount) AS amount'))
            ->groupBy('currency')
            ->get()
            ->map(fn ($row): array => [
                'currency' => $row->currency,
                'invoices' => (int) $row->invoices,
                'amount' => (string) $row->amount,
            ]);

        return response()->json([
            'client' => ClientAccountResource::make($client),
            'stats' => [
                'projects_total' => (int) array_sum($stages),
                'by_stage' => [
                    'in_progress' => $stages['in_progress'] ?? 0,
                    'in_review' => $stages['in_review'] ?? 0,
                    'ready' => $stages['ready'] ?? 0,
                    'completed' => $stages['completed'] ?? 0,
                    'cancelled' => $stages['cancelled'] ?? 0,
                ],
                'total_pages' => (int) $volume->pages,
                'total_words' => (int) $volume->words,
                'billing' => $billing,
                // max() hands back the raw column value, not a Carbon instance, so
                // the cast never runs — parse it or the client gets a bare
                // "2026-07-27 12:15:00+00" that browsers disagree about.
                'last_delivery_at' => Carbon::make(
                    $this->visibleProjects($client)->max('completed_at'),
                )?->toIso8601String(),
            ],
            'recent_projects' => ClientProjectResource::collection(
                $this->visibleProjects($client)
                    ->with(['sourceLanguage', 'targetLanguage'])
                    ->latest('created_at')
                    ->take(5)
                    ->get(),
            ),
        ]);
    }

    public function projects(Request $request): AnonymousResourceCollection
    {
        $projects = $this->visibleProjects($request->user())
            ->with(['sourceLanguage', 'targetLanguage', 'invoice:id,number'])
            ->when($request->filled('stage'), function ($query) use ($request): void {
                // Filtering happens on the client-facing stage, so the request never
                // has to name an internal status.
                $stage = $request->string('stage')->toString();
                $query->whereIn('status', array_keys(
                    array_filter(Project::CLIENT_STAGES, fn (string $s): bool => $s === $stage),
                ));
            })
            ->latest('created_at')
            ->paginate(min($request->integer('per_page', 12), 50));

        return ClientProjectResource::collection($projects);
    }

    public function project(Request $request, Project $project): ClientProjectResource
    {
        $this->authorizeProject($request, $project);

        return ClientProjectResource::make($project->load([
            'sourceLanguage', 'targetLanguage', 'invoice:id,number',
            'files' => fn ($query) => $query
                ->whereIn('category', ClientProjectResource::VISIBLE_CATEGORIES)
                ->orderBy('category')
                ->orderByDesc('created_at'),
        ]));
    }

    /** One certified file — the same bytes the PM sees, reached through the client's own scope. */
    public function downloadFile(Request $request, Project $project, ProjectFile $file): StreamedResponse
    {
        $this->authorizeProject($request, $project);

        abort_unless($file->project_id === $project->id, 404);
        abort_unless(in_array($file->category, ClientProjectResource::VISIBLE_CATEGORIES, true), 404);
        abort_unless(Storage::disk('local')->exists($file->disk_path), 404, __('projects.final_file_missing'));

        return Storage::disk('local')->download($file->disk_path, $file->original_name);
    }

    /** Every certified file of the project as one zip — the office's own builder, re-scoped. */
    public function finalArchive(Request $request, Project $project): BinaryFileResponse
    {
        $this->authorizeProject($request, $project);

        return app(ProjectFileController::class)->finalArchive($project);
    }

    public function invoices(Request $request): AnonymousResourceCollection
    {
        return InvoiceResource::collection(
            Invoice::query()
                ->where('client_id', $request->user()->id)
                ->latest('issued_at')
                ->paginate(min($request->integer('per_page', 12), 50)),
        );
    }

    public function downloadInvoice(Request $request, Invoice $invoice): StreamedResponse
    {
        abort_unless($invoice->client_id === $request->user()->id, 404);
        abort_unless($invoice->disk_path && Storage::disk('local')->exists($invoice->disk_path), 404);

        return Storage::disk('local')->download($invoice->disk_path, "{$invoice->number}.pdf");
    }

    private function authorizeProject(Request $request, Project $project): void
    {
        abort_unless($project->client_id === $request->user()->id, 404);
        abort_if($project->status === Project::STATUS_DRAFT, 404);
    }
}
