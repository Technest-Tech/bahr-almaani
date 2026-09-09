<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\DocumentRequestResource;
use App\Models\DocumentRequest;
use App\Models\Project;
use App\Models\ProjectFile;
use App\Notifications\DocumentReplacementRequestedNotification;
use App\Notifications\DocumentRequestedNotification;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Asking the client for a document a file cannot be translated without.
 *
 * The office's half of the loop; the client's half is
 * ClientPortalController::uploadFile, and the PM can close a request from the
 * ordinary file uploader by naming it (ProjectFileController::store) — which is
 * what actually happens when the scan arrives by WhatsApp.
 */
class DocumentRequestController extends Controller
{
    public function store(Request $request, Project $project): JsonResponse
    {
        abort_if(
            in_array($project->status, Project::SETTLED_STATUSES, true),
            422,
            __('projects.document_request_settled'),
        );

        $validated = $request->validate([
            // Scoped to this project's own source files: a request must not be able
            // to name a file belonging to somebody else's job.
            'project_file_id' => [
                'nullable',
                Rule::exists('project_files', 'id')
                    ->where('project_id', $project->id)
                    ->where('category', ProjectFile::CATEGORY_SOURCE),
            ],
            'kind' => ['required', Rule::in(DocumentRequest::KINDS)],
            'note' => ['nullable', 'string', 'max:1000'],
        ]);

        // Asking twice for the same thing on the same file would give the client two
        // identical boxes and the PM two rows to chase.
        $existing = $project->documentRequests()
            ->pending()
            ->where('kind', $validated['kind'])
            ->where('project_file_id', $validated['project_file_id'] ?? null)
            ->exists();

        abort_if($existing, 422, __('projects.document_request_duplicate'));

        $documentRequest = $project->documentRequests()->create([
            ...$validated,
            'requested_by' => $request->user()->id,
        ]);

        // A client with no account still gets the ask by mail and answers the way
        // they always have; the row is what the office tracks either way. Walk-in
        // clients carry no address at all — `email` is nullable — so the mail is
        // skipped rather than queued to fail, and the PM chases it by phone.
        if ($project->client?->email) {
            $project->client->notify(new DocumentRequestedNotification(
                $project,
                $documentRequest->load('file:id,original_name'),
            ));
        }

        return DocumentRequestResource::make($documentRequest->load(['file:id,original_name', 'attachments']))
            ->response()
            ->setStatusCode(201);
    }

    /**
     * Ask again: what arrived is not usable.
     *
     * The note is required and it is not bureaucracy — this reaches the client as
     * "the document you sent cannot be used", and without a reason they will send
     * the same photo back. What they sent is superseded, not deleted; see
     * DocumentRequest::reopen().
     */
    public function reopen(Request $request, Project $project, DocumentRequest $documentRequest): DocumentRequestResource
    {
        abort_unless($documentRequest->project_id === $project->id, 404);

        abort_if(
            in_array($project->status, Project::SETTLED_STATUSES, true),
            422,
            __('projects.document_request_settled'),
        );

        // Only a fulfilled request can be re-asked. A pending one is already open,
        // and a cancelled one the office withdrew on purpose.
        abort_unless(
            $documentRequest->status === DocumentRequest::STATUS_FULFILLED,
            422,
            __('projects.document_request_not_fulfilled'),
        );

        $validated = $request->validate([
            'note' => ['required', 'string', 'max:1000'],
        ]);

        $documentRequest->reopen($validated['note']);

        if ($project->client?->email) {
            $project->client->notify(new DocumentReplacementRequestedNotification(
                $project,
                $documentRequest->load('file:id,original_name'),
            ));
        }

        return DocumentRequestResource::make(
            $documentRequest->load(['file:id,original_name', 'attachments']),
        );
    }

    /** Withdraw an ask — the office found the document, or it was never needed. */
    public function cancel(Project $project, DocumentRequest $documentRequest): JsonResponse
    {
        abort_unless($documentRequest->project_id === $project->id, 404);
        abort_unless($documentRequest->isPending(), 422, __('projects.document_request_closed'));

        $documentRequest->forceFill([
            'status' => DocumentRequest::STATUS_CANCELLED,
            'cancelled_at' => now(),
        ])->save();

        return response()->json(['message' => __('projects.document_request_cancelled')]);
    }
}
