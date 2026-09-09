<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\ClientAccountResource;
use App\Http\Resources\ClientProjectResource;
use App\Http\Resources\DocumentRequestResource;
use App\Http\Resources\InvoiceResource;
use App\Models\Client;
use App\Models\Invoice;
use App\Models\Project;
use App\Models\ProjectFile;
use App\Notifications\DocumentSuppliedNotification;
use App\Notifications\DocumentWithdrawnNotification;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Arr;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
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
    /** An ID card is two sides; a family record is a few pages. Not a bulk channel. */
    private const MAX_CLIENT_FILES = 6;

    /** 20 MB — a phone photo with room to spare, well under the office's own 50. */
    private const MAX_CLIENT_FILE_KB = 20480;

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
                    ->withExists(['documentRequests as awaiting_documents' => fn ($query) => $query->pending()])
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
            // One EXISTS for the page: the card flags the projects still waiting
            // on the client, and the list never needs the requests themselves.
            ->withExists(['documentRequests as awaiting_documents' => fn ($query) => $query->pending()])
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
                ->visibleToClient()
                ->orderBy('category')
                ->orderByDesc('created_at'),
            'documentRequests' => fn ($query) => $query->with([
                'file:id,original_name',
                // `superseded_at` is load-bearing, not decoration: without it the
                // client sees a rejected file as still standing, offers to delete
                // it, and gets a 404 for their trouble.
                'attachments:id,document_request_id,original_name,size_bytes,superseded_at,created_at',
            ]),
        ]));
    }

    /** One certified file — the same bytes the PM sees, reached through the client's own scope. */
    public function downloadFile(Request $request, Project $project, ProjectFile $file): StreamedResponse
    {
        $this->authorizeProject($request, $project);

        abort_unless($file->project_id === $project->id, 404);
        abort_unless($file->isVisibleToClient(), 404);
        abort_unless(Storage::disk('local')->exists($file->disk_path), 404, __('projects.final_file_missing'));

        return Storage::disk('local')->download($file->disk_path, $file->original_name);
    }

    /** Every certified file of the project as one zip — the office's own builder, re-scoped. */
    public function finalArchive(Request $request, Project $project): BinaryFileResponse
    {
        $this->authorizeProject($request, $project);

        return app(ProjectFileController::class)->finalArchive($project);
    }

    /**
     * The client answering a document request from their own area.
     *
     * The first write the client area has ever had, and it is deliberately the
     * narrowest one that does the job: an upload must name an OPEN request on the
     * client's OWN project. There is no general "attach a file to my project" —
     * that would turn the portal into an inbox nobody watches, and it would let a
     * client add a document after pricing that the office never agreed to translate.
     *
     * Everything lands as `reference`, never `source`: source files are the quote
     * basis, they are counted, and the first of them names the project
     * (ProjectFileController::nameProjectAfterFirstSource). A client-supplied ID
     * card must not move any of that.
     */
    public function uploadFile(Request $request, Project $project): JsonResponse
    {
        $this->authorizeProject($request, $project);

        $client = $request->user();

        $validated = Validator::make([
            'document_request_id' => $request->input('document_request_id'),
            'files' => $this->uploads($request),
        ], [
            'document_request_id' => ['required', 'integer'],
            'files' => ['required', 'array', 'min:1', 'max:'.self::MAX_CLIENT_FILES],
            // Photos and scans. Narrower than the office's own upload on purpose:
            // this endpoint takes identity papers off the open internet, and an
            // Office macro has no business arriving through it.
            'files.*' => ['file', 'max:'.self::MAX_CLIENT_FILE_KB, 'mimes:pdf,jpg,jpeg,png,webp,heic,heif'],
        ])->validate();

        // 404 rather than 403 on someone else's request id, like every other lookup here.
        $documentRequest = $project->documentRequests()
            ->whereKey($validated['document_request_id'])
            ->pending()
            ->first();

        abort_if($documentRequest === null, 404, __('projects.document_request_closed'));

        $files = DB::transaction(function () use ($client, $project, $documentRequest, $validated): array {
            $stored = array_map(fn (UploadedFile $upload): ProjectFile => $project->files()->create([
                'category' => ProjectFile::CATEGORY_REFERENCE,
                // No `uploaded_by`: clients are not staff and do not live in `users`.
                'uploaded_by_client_id' => $client->id,
                'parent_file_id' => $documentRequest->project_file_id,
                'document_request_id' => $documentRequest->id,
                'original_name' => $upload->getClientOriginalName(),
                'disk_path' => $upload->store("projects/{$project->id}/reference", 'local'),
                'mime_type' => $upload->getClientMimeType(),
                'size_bytes' => $upload->getSize(),
                'count_status' => ProjectFile::COUNT_NOT_APPLICABLE,
            ]), $validated['files']);

            $documentRequest->markFulfilled();

            return $stored;
        });

        Notification::send(
            $documentRequest->recipients(),
            new DocumentSuppliedNotification($project, $documentRequest, $client, count($files)),
        );

        return response()->json([
            'message' => __('projects.document_supplied'),
            'data' => DocumentRequestResource::make(
                $documentRequest->fresh()->load(['file:id,original_name', 'attachments']),
            ),
        ], 201);
    }

    /**
     * The client removing a document they sent — almost always to send a better one.
     *
     * "I uploaded the wrong photo" was the first thing that happened in the wild,
     * and there was no way out of it: the upload closed the request, so the box
     * they would have used to fix it was gone. Deleting reopens the request (see
     * DocumentRequest::reopenIfUnanswered), which puts that box straight back.
     *
     * Bounded three ways: it must be a file THEY uploaded, still standing, on a
     * project that is still running. A file the office has already superseded is
     * part of the record of the job and is theirs to keep or remove, not the
     * client's — and once the job is settled nothing on it moves at all.
     */
    public function destroyFile(Request $request, Project $project, ProjectFile $file): JsonResponse
    {
        $this->authorizeProject($request, $project);

        $client = $request->user();

        abort_unless($file->project_id === $project->id, 404);
        abort_unless($file->uploaded_by_client_id === $client->id, 404);
        abort_unless($file->document_request_id !== null, 404);
        abort_if($file->isSuperseded(), 404);

        abort_if(
            in_array($project->status, Project::SETTLED_STATUSES, true),
            422,
            __('projects.document_delete_settled'),
        );

        // Read before the row goes: deleting nulls the FK on anything pointing here.
        $documentRequest = $file->documentRequest;
        $name = $file->original_name;

        Storage::disk('local')->delete($file->disk_path);
        $file->delete();

        $documentRequest?->reopenIfUnanswered();

        // A PM who downloaded that scan an hour ago is now working from a file the
        // client has withdrawn, and the request may have quietly reopened.
        if ($documentRequest !== null) {
            Notification::send(
                $documentRequest->recipients(),
                new DocumentWithdrawnNotification($project, $documentRequest->refresh(), $client, $name),
            );
        }

        return response()->json([
            'message' => __('projects.document_deleted'),
            'data' => $documentRequest === null ? null : DocumentRequestResource::make(
                $documentRequest->load(['file:id,original_name', 'attachments']),
            ),
        ]);
    }

    /**
     * The uploads, whether posted as `files[]` or as a single `file`.
     *
     * Does not touch the request's file bag — Request::allFiles() memoises on its
     * first read, so a write after any file() call is silently dropped and the
     * upload arrives as null. Same trap, same handling, as the office's uploader.
     *
     * @return list<UploadedFile>
     */
    private function uploads(Request $request): array
    {
        $uploads = $request->hasFile('files')
            ? Arr::wrap($request->file('files'))
            : Arr::wrap($request->file('file'));

        return array_values(array_filter($uploads));
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
