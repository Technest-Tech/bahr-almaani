<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\ProjectResource;
use App\Jobs\FinalizeProjectJob;
use App\Models\Assignment;
use App\Models\Project;
use App\Notifications\RevisionRequestedNotification;
use App\Services\ProjectTransitionService;
use Illuminate\Http\Request;

class ReviewController extends Controller
{
    public function __construct(
        private readonly ProjectTransitionService $transitions,
    ) {}

    /** delivered → in_review */
    public function open(Request $request, Project $project): ProjectResource
    {
        $project = $this->transitions->transition($project, Project::STATUS_IN_REVIEW, $request->user());

        return $this->fresh($project);
    }

    /** in_review → revision_requested (note mandatory; translator re-locked + notified). */
    public function requestRevision(Request $request, Project $project): ProjectResource
    {
        $validated = $request->validate(['note' => ['required', 'string', 'max:2000']]);

        $project = $this->transitions->transition(
            $project,
            Project::STATUS_REVISION_REQUESTED,
            $request->user(),
            $validated['note'],
        );

        $project->assignments()
            ->where('status', Assignment::STATUS_DELIVERED)
            ->latest('claimed_at')
            ->first()
            ?->translator
            ->notify(new RevisionRequestedNotification($project, $validated['note']));

        return $this->fresh($project);
    }

    /** in_review → approved, then the finalize job completes it. */
    public function approve(Request $request, Project $project): ProjectResource
    {
        $project = $this->transitions->transition($project, Project::STATUS_APPROVED, $request->user());

        FinalizeProjectJob::dispatch($project);

        return $this->fresh($project);
    }

    private function fresh(Project $project): ProjectResource
    {
        return ProjectResource::make(
            $project->load(['client', 'sourceLanguage', 'targetLanguage', 'files.uploader:id,name']),
        );
    }
}
