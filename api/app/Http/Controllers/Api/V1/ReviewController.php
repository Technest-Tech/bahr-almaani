<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\ProjectResource;
use App\Jobs\FinalizeProjectJob;
use App\Models\Assignment;
use App\Models\LetterheadTemplate;
use App\Models\Project;
use App\Notifications\RevisionRequestedNotification;
use App\Services\ProjectTransitionService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

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

    /**
     * in_review → approved, then the finalize job completes it.
     *
     * The letterhead + stamp are chosen here and persisted on the project, so the
     * merge job (M9b) reads its overlay configuration straight off the record.
     */
    public function approve(Request $request, Project $project): ProjectResource
    {
        $validated = $request->validate([
            'letterhead_id' => [
                'required', 'integer',
                Rule::exists('letterhead_templates', 'id')
                    ->where('kind', LetterheadTemplate::KIND_LETTERHEAD)
                    ->where('is_active', true),
            ],
            'stamp_id' => [
                'required', 'integer',
                Rule::exists('letterhead_templates', 'id')
                    ->where('kind', LetterheadTemplate::KIND_STAMP)
                    ->where('is_active', true),
            ],
        ]);

        // One transaction: an invalid transition must not leave a selection behind
        // on a project that was never approved.
        $project = DB::transaction(function () use ($project, $request, $validated): Project {
            $project->fill($validated)->save();

            return $this->transitions->transition($project, Project::STATUS_APPROVED, $request->user());
        });

        FinalizeProjectJob::dispatch($project);

        return $this->fresh($project);
    }

    private function fresh(Project $project): ProjectResource
    {
        return ProjectResource::make(
            $project->load(['client', 'sourceLanguage', 'targetLanguage', 'files.uploader:id,name', 'letterhead', 'stamp']),
        );
    }
}
