<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\RespondToQuoteRequestRequest;
use App\Http\Resources\ProjectResource;
use App\Http\Resources\QuoteRequestResource;
use App\Jobs\CountWordsJob;
use App\Models\Client;
use App\Models\Project;
use App\Models\ProjectFile;
use App\Models\QuoteRequest;
use App\Notifications\QuoteRespondedNotification;
use App\Services\ProjectCodeGenerator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

/** Staff-side inbox for website quote requests (M13). */
class QuoteRequestController extends Controller
{
    private const RELATIONS = ['sourceLanguage', 'targetLanguage', 'responder:id,name', 'client', 'project:id,code,status'];

    public function index(Request $request): AnonymousResourceCollection
    {
        $quotes = QuoteRequest::query()
            ->with(['sourceLanguage', 'targetLanguage', 'responder:id,name'])
            ->withCount('files')
            // Plain SQL rather than Scout: quote requests are a small, short-lived
            // inbox and adding an index would mean another Meilisearch sync to babysit.
            ->when($request->filled('q'), function ($query) use ($request): void {
                $term = '%'.str_replace('%', '\%', $request->string('q')->trim()->toString()).'%';
                $query->where(fn ($q) => $q
                    ->where('reference', 'ILIKE', $term)
                    ->orWhere('name', 'ILIKE', $term)
                    ->orWhere('email', 'ILIKE', $term)
                    ->orWhere('organization', 'ILIKE', $term)
                    ->orWhere('title', 'ILIKE', $term));
            })
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')->toString()))
            ->when($request->filled('priority'), fn ($q) => $q->where('priority', $request->string('priority')->toString()))
            ->when($request->boolean('open'), fn ($q) => $q->open())
            ->tap(function ($query) use ($request): void {
                // Server-side sorting: the whole result set, not just the current page.
                $sortable = ['created_at', 'reference', 'name', 'status', 'priority', 'needed_by', 'quoted_amount'];
                $sort = $request->string('sort')->toString();
                $query->orderBy(
                    in_array($sort, $sortable, true) ? $sort : 'created_at',
                    $request->string('dir')->toString() === 'asc' ? 'asc' : 'desc',
                );
            })
            ->paginate(min($request->integer('per_page', 15), 100));

        return QuoteRequestResource::collection($quotes);
    }

    public function show(QuoteRequest $quoteRequest): QuoteRequestResource
    {
        return QuoteRequestResource::make($quoteRequest->load([...self::RELATIONS, 'files']));
    }

    /** Move a request along the triage lane without pricing it. */
    public function updateStatus(Request $request, QuoteRequest $quoteRequest): QuoteRequestResource
    {
        $validated = $request->validate([
            'status' => ['required', Rule::in([
                QuoteRequest::STATUS_NEW,
                QuoteRequest::STATUS_REVIEWING,
                QuoteRequest::STATUS_ACCEPTED,
                QuoteRequest::STATUS_DECLINED,
            ])],
        ]);

        abort_if(
            $quoteRequest->status === QuoteRequest::STATUS_CONVERTED,
            422,
            __('quotes.already_converted'),
        );

        // "Accepted" is the client saying yes to a price — there has to be one.
        abort_if(
            $validated['status'] === QuoteRequest::STATUS_ACCEPTED && ! $quoteRequest->hasQuote(),
            422,
            __('quotes.accept_requires_quote'),
        );

        $quoteRequest->update($validated);

        return QuoteRequestResource::make($quoteRequest->load(self::RELATIONS));
    }

    /** Price the request and (by default) mail the answer to the requester. */
    public function respond(RespondToQuoteRequestRequest $request, QuoteRequest $quoteRequest): QuoteRequestResource
    {
        abort_if(
            $quoteRequest->status === QuoteRequest::STATUS_CONVERTED,
            422,
            __('quotes.already_converted'),
        );

        $validated = $request->validated();

        $quoteRequest->update([
            ...collect($validated)->except('notify_client')->all(),
            'currency' => strtoupper($validated['currency']),
            // Accepted/declined requests keep their standing — re-pricing one shouldn't
            // silently drag it back to "quoted".
            'status' => in_array($quoteRequest->status, [QuoteRequest::STATUS_ACCEPTED, QuoteRequest::STATUS_DECLINED], true)
                ? $quoteRequest->status
                : QuoteRequest::STATUS_QUOTED,
            'responded_at' => now(),
            'responded_by' => $request->user()->id,
        ]);

        if ($request->boolean('notify_client', true)) {
            // An anonymous notifiable: the requester has no account, only an inbox.
            Notification::route('mail', $quoteRequest->email)
                ->notify(new QuoteRespondedNotification($quoteRequest->fresh()));
        }

        return QuoteRequestResource::make($quoteRequest->load(self::RELATIONS));
    }

    /**
     * Turn an accepted request into a real project.
     *
     * This is the single bridge between the public module and the operational one:
     * a draft project is created, the visitor's attachments are copied in as source
     * files, and the request is closed as `converted` with the link kept both ways.
     */
    public function convert(Request $request, QuoteRequest $quoteRequest, ProjectCodeGenerator $codes): JsonResponse
    {
        abort_if(
            $quoteRequest->project_id !== null,
            422,
            __('quotes.already_converted'),
        );

        $validated = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'source_language_id' => ['required', 'integer', Rule::exists('languages', 'id')->where('is_active', true)],
            'target_language_id' => [
                'required', 'integer', 'different:source_language_id',
                Rule::exists('languages', 'id')->where('is_active', true),
            ],
            'deadline_at' => ['required', 'date', 'after:now'],
            'priority' => ['required', Rule::in([Project::PRIORITY_NORMAL, Project::PRIORITY_URGENT, Project::PRIORITY_CRITICAL])],
            'service_type' => ['required', Rule::in(['certified', 'regular'])],
            'quoted_amount' => ['nullable', 'numeric', 'min:0', 'max:99999999'],
            // Reuse an existing client record, or let us mint one from the request.
            'client_id' => ['nullable', 'integer', Rule::exists('clients', 'id')->withoutTrashed()],
            'create_client' => ['sometimes', 'boolean'],
        ]);

        $project = DB::transaction(function () use ($request, $validated, $quoteRequest, $codes): Project {
            $clientId = $validated['client_id'] ?? null;

            if ($clientId === null && $request->boolean('create_client', true)) {
                $clientId = Client::create([
                    'name' => $quoteRequest->organization ?: $quoteRequest->name,
                    'type' => $quoteRequest->organization ? 'company' : 'individual',
                    'phone' => $quoteRequest->phone,
                    'email' => $quoteRequest->email,
                    'notes' => __('quotes.client_note', ['reference' => $quoteRequest->reference]),
                    'created_by' => $request->user()->id,
                ])->id;
            }

            $project = Project::create([
                'code' => $codes->next(),
                'client_id' => $clientId,
                'title' => $validated['title'],
                'source_language_id' => $validated['source_language_id'],
                'target_language_id' => $validated['target_language_id'],
                'service_type' => $validated['service_type'],
                'priority' => $validated['priority'],
                'status' => Project::STATUS_DRAFT,
                'declared_pages' => $quoteRequest->declared_pages,
                'deadline_at' => $validated['deadline_at'],
                'instructions' => $quoteRequest->details,
                'quoted_amount' => $validated['quoted_amount'] ?? $quoteRequest->quoted_amount,
                'currency' => $quoteRequest->currency,
                'created_by' => $request->user()->id,
            ]);

            $this->copyAttachments($quoteRequest, $project, $request->user()->id);

            $quoteRequest->update([
                'status' => QuoteRequest::STATUS_CONVERTED,
                'client_id' => $clientId,
                'project_id' => $project->id,
            ]);

            return $project;
        });

        return ProjectResource::make($project->load(['client', 'sourceLanguage', 'targetLanguage']))
            ->additional(['message' => __('quotes.converted', ['code' => $project->code])])
            ->response()
            ->setStatusCode(201);
    }

    public function downloadFile(QuoteRequest $quoteRequest, int $fileId): StreamedResponse
    {
        $file = $quoteRequest->files()->findOrFail($fileId);

        abort_unless(Storage::disk('local')->exists($file->disk_path), 404, __('quotes.file_missing'));

        return Storage::disk('local')->download($file->disk_path, $file->original_name);
    }

    public function destroy(QuoteRequest $quoteRequest): JsonResponse
    {
        abort_if(
            $quoteRequest->project_id !== null,
            422,
            __('quotes.delete_converted'),
        );

        // Soft delete keeps the reference reserved, so a stale link can never
        // resolve to a different visitor's request later on.
        $quoteRequest->delete();

        return response()->json(['message' => 'ok']);
    }

    /**
     * Copy (never move) the visitor's uploads into the project.
     *
     * The originals stay put: the request remains auditable evidence of what was
     * priced, even after the project's own files are revised.
     */
    private function copyAttachments(QuoteRequest $quoteRequest, Project $project, int $actorId): void
    {
        $disk = Storage::disk('local');

        foreach ($quoteRequest->files as $attachment) {
            if (! $disk->exists($attachment->disk_path)) {
                continue;
            }

            $target = "projects/{$project->id}/".ProjectFile::CATEGORY_SOURCE
                .'/'.basename($attachment->disk_path);

            $disk->copy($attachment->disk_path, $target);

            $file = $project->files()->create([
                'category' => ProjectFile::CATEGORY_SOURCE,
                'uploaded_by' => $actorId,
                'original_name' => $attachment->original_name,
                'disk_path' => $target,
                'mime_type' => $attachment->mime_type,
                'size_bytes' => $attachment->size_bytes,
            ]);

            CountWordsJob::dispatch($file);
        }
    }
}
