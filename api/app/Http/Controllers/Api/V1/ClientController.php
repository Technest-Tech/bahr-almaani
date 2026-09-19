<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreClientRequest;
use App\Http\Resources\ClientProjectResource;
use App\Http\Resources\ClientResource;
use App\Http\Resources\InvoiceResource;
use App\Http\Resources\QuoteRequestResource;
use App\Models\Client;
use App\Models\Invoice;
use App\Models\Project;
use App\Models\QuoteRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class ClientController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $clients = Client::query()
            ->withCount($this->visibleProjects($request))
            ->when($request->filled('q'), function ($query) use ($request): void {
                // Scout (Meilisearch): typo-tolerant search over name/phone/email/notes.
                $query->whereIn('clients.id', Client::search(
                    $request->string('q')->trim()->toString(),
                )->take(500)->keys());
            })
            ->when($request->filled('type'), fn ($query) => $query->where('type', $request->string('type')->toString()))
            // M15 — "which of my clients can actually sign in?" is a question the
            // office asks while rolling the portal out.
            ->when($request->filled('account'), function ($query) use ($request): void {
                $request->string('account')->toString() === 'yes'
                    ? $query->whereNotNull('password')
                    : $query->whereNull('password');
            })
            ->tap(function ($query) use ($request): void {
                // Server-side sorting: the whole result set, not just the current page.
                $sortable = ['name', 'type', 'created_at', 'projects_count'];
                $sort = $request->string('sort')->toString();
                $query->orderBy(
                    in_array($sort, $sortable, true) ? $sort : 'created_at',
                    $request->string('dir')->toString() === 'asc' ? 'asc' : 'desc',
                );
            })
            ->paginate(min($request->integer('per_page', 15), 100));

        return ClientResource::collection($clients);
    }

    public function show(Request $request, Client $client): ClientResource
    {
        return ClientResource::make($client->loadCount([...$this->visibleProjects($request), 'invoices']));
    }

    /**
     * The admin's client file (M15): the same history the client sees in their own
     * area, plus what only the office may see — internal notes, account state, the
     * quote requests they sent and the money side.
     *
     * A PM's view of it holds their own projects only; clients are shared, projects
     * are not (Project::visibleTo). Invoices and quote requests stay whole.
     *
     * Projects and invoices come back in full, not the latest ten: the office reads
     * this page to see what a client was billed for, and a capped list hid every
     * older invoice with no way to reach it.
     */
    public function overview(Request $request, Client $client): JsonResponse
    {
        $projects = Project::query()->visibleTo($request->user())->where('client_id', $client->id);

        $byStatus = (clone $projects)
            ->select('status', DB::raw('COUNT(*) AS total'))
            ->groupBy('status')
            ->pluck('total', 'status');

        $volume = (clone $projects)
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
            'client' => ClientResource::make($client->loadCount([...$this->visibleProjects($request), 'invoices'])),
            'stats' => [
                'by_status' => $byStatus,
                'total_pages' => (int) $volume->pages,
                'total_words' => (int) $volume->words,
                // Finished work nobody has billed yet — the number the office chases.
                'uninvoiced_projects' => (clone $projects)
                    ->whereIn('status', [Project::STATUS_COMPLETED, Project::STATUS_ARCHIVED])
                    ->whereNull('invoice_id')
                    ->count(),
                'billing' => $billing,
                // See ClientPortalController::overview — max() bypasses the cast.
                'last_delivery_at' => Carbon::make((clone $projects)->max('completed_at'))
                    ?->toIso8601String(),
            ],
            'projects' => ClientProjectResource::collection(
                (clone $projects)
                    ->with(['sourceLanguage', 'targetLanguage', 'invoice:id,number'])
                    // Uncapped now, so no per-row query for awaitsDocuments().
                    ->withExists(['documentRequests as awaiting_documents' => fn ($query) => $query->pending()])
                    ->latest('created_at')
                    ->get(),
            ),
            'invoices' => InvoiceResource::collection(
                Invoice::query()
                    ->where('client_id', $client->id)
                    ->latest('issued_at')
                    ->get(),
            ),
            'quote_requests' => QuoteRequestResource::collection(
                QuoteRequest::query()
                    ->where('client_id', $client->id)
                    ->with(['sourceLanguage', 'targetLanguage'])
                    ->latest()
                    ->take(10)
                    ->get(),
            ),
        ]);
    }

    public function store(StoreClientRequest $request): JsonResponse
    {
        $validated = $request->validated();

        $client = Client::create([
            ...$validated,
            // A blank password field means "no website account", not an empty one.
            'password' => filled($validated['password'] ?? null) ? $validated['password'] : null,
            'status' => $validated['status'] ?? Client::STATUS_ACTIVE,
            'created_by' => $request->user()->id,
        ]);

        return ClientResource::make($client)->response()->setStatusCode(201);
    }

    public function update(StoreClientRequest $request, Client $client): ClientResource
    {
        $validated = $request->validated();

        // Left empty, the password field means "leave it alone" — the office edits a
        // phone number far more often than it resets an account.
        $resetsPassword = filled($validated['password'] ?? null);

        if (! $resetsPassword) {
            unset($validated['password']);
        }

        // Both fields are optional on the wire; an absent one must not blank the row.
        if (! filled($validated['status'] ?? null)) {
            unset($validated['status']);
        }

        $wasSuspended = $client->isSuspended();

        $client->update($validated);

        // A new password, or a suspension, ends every session the client had open.
        if ($resetsPassword || (! $wasSuspended && $client->isSuspended())) {
            $client->tokens()->delete();
        }

        return ClientResource::make($client->loadCount($this->visibleProjects($request)));
    }

    /** Take the website account away without touching the client's record or history. */
    public function revokeAccount(Request $request, Client $client): ClientResource
    {
        $client->forceFill(['password' => null])->save();
        $client->tokens()->delete();

        return ClientResource::make($client->loadCount($this->visibleProjects($request)));
    }

    public function destroy(Client $client): JsonResponse
    {
        abort_if(
            $client->projects()->exists(),
            422,
            __('clients.has_projects'),
        );

        $client->tokens()->delete();
        $client->delete();

        return response()->json(['message' => 'ok']);
    }

    /**
     * `projects_count` as the viewer sees it — a PM counts their own projects, the
     * same ones the client's file lists for them. Deleting a client still checks
     * every project (destroy()), whoever owns them.
     *
     * @return array<string, \Closure>
     */
    private function visibleProjects(Request $request): array
    {
        return ['projects' => fn ($query) => $query->visibleTo($request->user())];
    }
}
