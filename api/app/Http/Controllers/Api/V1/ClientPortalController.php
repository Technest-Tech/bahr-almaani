<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreClientProjectRequest;
use App\Http\Resources\ClientAccountResource;
use App\Http\Resources\ClientProjectResource;
use App\Http\Resources\DocumentRequestResource;
use App\Http\Resources\InvoiceResource;
use App\Jobs\CountWordsJob;
use App\Models\Client;
use App\Models\DocumentRequest;
use App\Models\Invoice;
use App\Models\Project;
use App\Models\ProjectFile;
use App\Models\User;
use App\Notifications\ClientProjectSubmittedNotification;
use App\Notifications\DocumentSuppliedNotification;
use App\Notifications\DocumentWithdrawnNotification;
use App\Services\ProjectCodeGenerator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Arr;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
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
     * The office's own draft is still being assembled — no deadline committed, often
     * no files yet — so it stays internal until it is published. A draft the client
     * submitted is the exception: they created it, and it is theirs to follow.
     */
    private function visibleProjects(Client $client)
    {
        return Project::query()
            ->where('client_id', $client->id)
            ->where(fn ($query) => $query
                ->where('status', '!=', Project::STATUS_DRAFT)
                ->orWhere('client_submitted', true));
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
                    'submitted' => $stages['submitted'] ?? 0,
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

    /**
     * A new project, started by the client from their own area.
     *
     * Asked for 2026-09-19: a client with an account still had to go through the
     * public quote form — the stranger's form — for every new job, re-typing who they
     * are, and the office then converted each request into a project by hand. Now it
     * lands as a draft already linked to the client, its documents stored and counted
     * as work files, exactly as if a PM had opened it.
     *
     * It goes no further on its own. Nothing reaches a translator until a PM has
     * checked the date, the letterhead and the stamp and published it, and the first
     * PM to edit or publish it becomes its owner (ProjectController). The office is
     * still the gate; only the re-typing and the conversion are gone.
     */
    public function storeProject(StoreClientProjectRequest $request, ProjectCodeGenerator $codes): JsonResponse
    {
        $client = $request->user();
        $validated = $request->validated();
        $code = $codes->next();
        $titled = filled($validated['title'] ?? null);

        $project = DB::transaction(function () use ($client, $validated, $code, $titled): Project {
            $project = Project::create([
                ...Arr::except($validated, 'files'),
                'code' => $code,
                // Seeded with the code like the office's own blank name, and handed
                // over to the first file in storeSources().
                'title' => $titled ? $validated['title'] : $code,
                'title_auto' => ! $titled,
                'client_id' => $client->id,
                'client_submitted' => true,
                'status' => Project::STATUS_DRAFT,
            ]);

            $this->storeSources($project, $client, $validated['files']);

            return $project;
        });

        Notification::send(
            $this->projectManagers(),
            new ClientProjectSubmittedNotification($project, $client, count($validated['files'])),
        );

        return ClientProjectResource::make($project->fresh(['sourceLanguage', 'targetLanguage']))
            ->additional(['message' => __('projects.client_project_submitted', ['code' => $project->code])])
            ->response()
            ->setStatusCode(201);
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
     * The client sending files to their own project — asked for, or not.
     *
     * With `document_request_id` it answers that request, which must still be open:
     * the files hang off the work file the request names and close it. Without one
     * it is the client adding documents on their own initiative (client request
     * 2026-09-13 — the portal used to take files only when the office had asked, so a
     * client with a second document had no way to send it).
     *
     * Either way everything lands as `reference`, never `source`, and that is what
     * keeps the open door safe. Source files are the quote basis: they are counted,
     * the first names the project, and after publication they are frozen for the
     * office too. A client upload moves none of that — it reaches the PM, who decides
     * what it means for the job, and the translator sees it as supporting material.
     *
     * The one exception is `category=source` on a project the client submitted
     * themselves and the office has not published yet (addSources): until then they
     * are still putting the job together, and the quote basis is theirs to set.
     */
    public function uploadFile(Request $request, Project $project): JsonResponse
    {
        $this->authorizeProject($request, $project);

        if ($request->input('category') === ProjectFile::CATEGORY_SOURCE) {
            return $this->addSources($request, $project);
        }

        $client = $request->user();

        $validated = Validator::make([
            'document_request_id' => $request->input('document_request_id'),
            'files' => $this->uploads($request),
        ], [
            'document_request_id' => ['nullable', 'integer'],
            'files' => ['required', 'array', 'min:1', 'max:'.self::MAX_CLIENT_FILES],
            // Photos and scans. Narrower than the office's own upload on purpose:
            // this endpoint takes identity papers off the open internet, and an
            // Office macro has no business arriving through it.
            'files.*' => ['file', 'max:'.self::MAX_CLIENT_FILE_KB, 'mimes:pdf,jpg,jpeg,png,webp,heic,heif'],
        ])->validate();

        // 404 rather than 403 on someone else's request id, like every other lookup here.
        $documentRequest = isset($validated['document_request_id'])
            ? $project->documentRequests()
                ->whereKey($validated['document_request_id'])
                ->pending()
                ->first()
            : null;

        abort_if(
            isset($validated['document_request_id']) && $documentRequest === null,
            404,
            __('projects.document_request_closed'),
        );

        // A finished job takes nothing more. An open request on it is answered the
        // same way it always was; only the unprompted door closes.
        abort_if(
            $documentRequest === null && in_array($project->status, Project::SETTLED_STATUSES, true),
            422,
            __('projects.client_upload_settled'),
        );

        $files = DB::transaction(function () use ($client, $project, $documentRequest, $validated): array {
            $stored = array_map(fn (UploadedFile $upload): ProjectFile => $project->files()->create([
                'category' => ProjectFile::CATEGORY_REFERENCE,
                // No `uploaded_by`: clients are not staff and do not live in `users`.
                'uploaded_by_client_id' => $client->id,
                'parent_file_id' => $documentRequest?->project_file_id,
                'document_request_id' => $documentRequest?->id,
                'original_name' => $upload->getClientOriginalName(),
                'disk_path' => $upload->store("projects/{$project->id}/reference", 'local'),
                'mime_type' => $upload->getClientMimeType(),
                'size_bytes' => $upload->getSize(),
                'count_status' => ProjectFile::COUNT_NOT_APPLICABLE,
            ]), $validated['files']);

            $documentRequest?->markFulfilled();

            return $stored;
        });

        Notification::send(
            $this->officeRecipients($project, $documentRequest),
            new DocumentSuppliedNotification($project, $documentRequest, $client, count($files)),
        );

        if ($documentRequest === null) {
            return response()->json([
                'message' => __('projects.client_files_uploaded'),
                'data' => array_map(fn (ProjectFile $file): array => ClientProjectResource::file($file), $files),
            ], 201);
        }

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
     * client's — and once the job is settled nothing on it moves at all. That covers
     * files sent unprompted as well as request answers: both are the client's own.
     */
    public function destroyFile(Request $request, Project $project, ProjectFile $file): JsonResponse
    {
        $this->authorizeProject($request, $project);

        $client = $request->user();

        abort_unless($file->project_id === $project->id, 404);
        abort_unless($file->uploaded_by_client_id === $client->id, 404);
        abort_if($file->isSuperseded(), 404);

        // A work file is the job itself. The client may take one back only while
        // their own submission still waits on the office; once published it is
        // frozen, for the office too.
        abort_if(
            $file->category === ProjectFile::CATEGORY_SOURCE && ! $project->isClientDraft(),
            422,
            __('projects.client_source_draft_only'),
        );

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

        if ($file->category === ProjectFile::CATEGORY_SOURCE) {
            $project->refreshTotals();
        }

        $documentRequest?->reopenIfUnanswered();

        // A PM who downloaded that scan an hour ago is now working from a file the
        // client has withdrawn, and a request it answered may have quietly reopened.
        Notification::send(
            $this->officeRecipients($project, $documentRequest),
            new DocumentWithdrawnNotification($project, $documentRequest?->refresh(), $client, $name),
        );

        return response()->json([
            'message' => __('projects.document_deleted'),
            'data' => $documentRequest === null ? null : DocumentRequestResource::make(
                $documentRequest->load(['file:id,original_name', 'attachments']),
            ),
        ]);
    }

    /**
     * More documents to translate on the client's own draft — the page they forgot,
     * or the right file after withdrawing the wrong one.
     *
     * Only until the office publishes it. From then on the work files are frozen,
     * and anything more the client sends is supporting material (uploadFile).
     */
    private function addSources(Request $request, Project $project): JsonResponse
    {
        abort_unless($project->isClientDraft(), 422, __('projects.client_source_draft_only'));

        $client = $request->user();

        $validated = Validator::make(
            ['files' => $this->uploads($request)],
            StoreClientProjectRequest::fileRules(),
        )->validate();

        $files = DB::transaction(fn (): array => $this->storeSources($project, $client, $validated['files']));

        Notification::send(
            $this->officeRecipients($project, null),
            new DocumentSuppliedNotification($project, null, $client, count($files), toTranslate: true),
        );

        return response()->json([
            'message' => __('projects.client_files_uploaded'),
            'data' => array_map(fn (ProjectFile $file): array => ClientProjectResource::file($file), $files),
        ], 201);
    }

    /**
     * Store documents to translate on the client's draft: work files, counted like
     * the office's own, and marked as the client's so they can still take one back
     * while the office has not published the project.
     *
     * @param  list<UploadedFile>  $uploads
     * @return list<ProjectFile>
     */
    private function storeSources(Project $project, Client $client, array $uploads): array
    {
        $hadSources = $project->files()->where('category', ProjectFile::CATEGORY_SOURCE)->exists();

        $files = array_map(fn (UploadedFile $upload): ProjectFile => $project->files()->create([
            'category' => ProjectFile::CATEGORY_SOURCE,
            'uploaded_by_client_id' => $client->id,
            'original_name' => $upload->getClientOriginalName(),
            'disk_path' => $upload->store("projects/{$project->id}/".ProjectFile::CATEGORY_SOURCE, 'local'),
            'mime_type' => $upload->getClientMimeType(),
            'size_bytes' => $upload->getSize(),
        ]), $uploads);

        // After commit, so the counter reads rows that exist.
        foreach ($files as $file) {
            CountWordsJob::dispatch($file)->afterCommit();
        }

        // The first work file names an unnamed project, the same rule as the office's
        // upload (ProjectFileController::nameProjectAfterFirstSource).
        $base = trim(pathinfo((string) ($files[0]->original_name ?? ''), PATHINFO_FILENAME));

        if (! $hadSources && $project->title_auto && $base !== '') {
            $project->forceFill(['title' => Str::limit($base, 255, '')])->save();
        }

        return $files;
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

    /**
     * Who in the office hears about a client's file: the people behind the request it
     * answers, or — for a file nobody asked for — the PM who owns the project.
     *
     * @return Collection<int, User>
     */
    private function officeRecipients(Project $project, ?DocumentRequest $documentRequest): Collection
    {
        if ($documentRequest !== null) {
            return $documentRequest->recipients();
        }

        // The client's own submission has no owner until a PM takes it.
        if ($project->created_by === null) {
            return $this->projectManagers();
        }

        return User::query()
            ->whereKey($project->created_by)
            ->where('status', User::STATUS_ACTIVE)
            ->with('notificationPreferences')
            ->get();
    }

    /**
     * Every active PM: who hears about work nobody in the office owns yet.
     *
     * @return Collection<int, User>
     */
    private function projectManagers(): Collection
    {
        return User::permission('projects.manage')
            ->where('status', User::STATUS_ACTIVE)
            ->with('notificationPreferences')
            ->get();
    }

    private function authorizeProject(Request $request, Project $project): void
    {
        abort_unless($project->client_id === $request->user()->id, 404);
        // Same rule as visibleProjects(): the office's drafts only, not the client's own.
        abort_if($project->status === Project::STATUS_DRAFT && ! $project->client_submitted, 404);
    }
}
