<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\AssignmentResource;
use App\Http\Resources\PortalProjectResource;
use App\Models\Assignment;
use App\Models\Project;
use App\Notifications\ProjectDeliveredNotification;
use App\Services\PortalService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class PortalController extends Controller
{
    public function __construct(
        private readonly PortalService $portal,
    ) {}

    public function queue(Request $request): AnonymousResourceCollection
    {
        return PortalProjectResource::collection(
            $this->portal->queueFor($request->user())
                ->paginate(min($request->integer('per_page', 20), 50)),
        );
    }

    public function claim(Request $request, Project $project): AssignmentResource
    {
        $assignment = $this->portal->claim($project, $request->user());

        return AssignmentResource::make(
            $assignment->load(['project.sourceLanguage', 'project.targetLanguage', 'project.files']),
        );
    }

    public function current(Request $request): JsonResponse
    {
        $assignment = $this->portal->currentAssignment($request->user());

        if ($assignment === null) {
            return response()->json(['data' => null]);
        }

        $revision = $this->portal->revisionNote($assignment->project);

        return response()->json([
            'data' => AssignmentResource::make($assignment)->resolve($request),
            'revision_note' => $revision ? [
                'note' => $revision->note,
                'by' => $revision->actor?->name,
                'at' => $revision->created_at->toIso8601String(),
            ] : null,
        ]);
    }

    public function deliver(Request $request): AssignmentResource
    {
        $validated = $request->validate([
            'file' => ['required', 'file', 'max:51200'],
        ]);

        $assignment = $this->portal->deliver($request->user(), $validated['file']);

        $assignment->project->creator->notify(new ProjectDeliveredNotification($assignment->project, $request->user()));

        return AssignmentResource::make($assignment->load('project'));
    }

    public function history(Request $request): AnonymousResourceCollection
    {
        $assignments = Assignment::query()
            ->where('translator_id', $request->user()->id)
            ->whereIn('status', [Assignment::STATUS_DELIVERED, Assignment::STATUS_WITHDRAWN])
            ->with(['project.sourceLanguage', 'project.targetLanguage'])
            ->latest('claimed_at')
            ->paginate(min($request->integer('per_page', 15), 100));

        return AssignmentResource::collection($assignments);
    }

    /** Translators may download files ONLY for the project they currently hold. */
    public function downloadFile(Request $request, int $fileId): StreamedResponse
    {
        $assignment = $this->portal->currentAssignment($request->user());
        abort_if($assignment === null, 404);

        $file = $assignment->project->files()->whereKey($fileId)->firstOrFail();

        return Storage::disk('local')->download($file->disk_path, $file->original_name);
    }
}
