<?php

namespace App\Services;

use App\Exceptions\ClaimConflictException;
use App\Models\Assignment;
use App\Models\Project;
use App\Models\ProjectFile;
use App\Models\StatusTransition;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

class PortalService
{
    public function __construct(
        private readonly ProjectTransitionService $transitions,
    ) {}

    /**
     * Available projects for this translator: matching language pairs,
     * urgent first, nearest deadline first. Ordering is server-enforced.
     */
    public function queueFor(User $translator)
    {
        return Project::query()
            ->where('status', Project::STATUS_AVAILABLE)
            ->whereIn(
                DB::raw('(source_language_id, target_language_id)'),
                $translator->languagePairs()
                    ->select('source_language_id', 'target_language_id')
                    ->getQuery(),
            )
            ->with(['sourceLanguage', 'targetLanguage'])
            ->withCount(['files as source_files_count' => fn ($q) => $q->where('category', ProjectFile::CATEGORY_SOURCE)])
            ->orderByRaw("CASE priority WHEN 'critical' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END")
            ->orderBy('deadline_at');
    }

    /**
     * Atomic claim. Row lock + status re-check + DB partial unique indexes:
     * double-claiming is impossible even under concurrent requests.
     *
     * @throws ClaimConflictException
     */
    public function claim(Project $project, User $translator): Assignment
    {
        $this->assertNotBusy($translator);

        try {
            return DB::transaction(function () use ($project, $translator): Assignment {
                /** @var Project $fresh */
                $fresh = Project::whereKey($project->getKey())->lockForUpdate()->firstOrFail();

                if ($fresh->status !== Project::STATUS_AVAILABLE) {
                    throw new ClaimConflictException(__('portal.already_claimed'));
                }

                $matches = $translator->languagePairs()
                    ->where('source_language_id', $fresh->source_language_id)
                    ->where('target_language_id', $fresh->target_language_id)
                    ->exists();

                if (! $matches) {
                    throw new ClaimConflictException(__('portal.language_pair_mismatch'));
                }

                $assignment = Assignment::create([
                    'project_id' => $fresh->id,
                    'translator_id' => $translator->id,
                    'status' => Assignment::STATUS_ACTIVE,
                    'claimed_at' => now(),
                ]);

                $this->transitions->transition($fresh, Project::STATUS_CLAIMED, $translator);

                return $assignment;
            });
        } catch (UniqueConstraintViolationException) {
            // Backstop: partial unique indexes fired under a race the app checks missed.
            throw new ClaimConflictException(__('portal.already_claimed'));
        }
    }

    /**
     * Deliver the translation (first delivery or a revision re-delivery).
     * Work time accumulates per active window: claim→deliver and each
     * revision-request→re-deliver, computed from the transition log.
     */
    public function deliver(User $translator, UploadedFile $upload): Assignment
    {
        return DB::transaction(function () use ($translator, $upload): Assignment {
            $assignment = $this->currentAssignment($translator);

            abort_if($assignment === null, 404, __('portal.no_active_assignment'));

            /** @var Project $project */
            $project = Project::whereKey($assignment->project_id)->lockForUpdate()->firstOrFail();

            abort_unless(
                in_array($project->status, [Project::STATUS_CLAIMED, Project::STATUS_REVISION_REQUESTED], true),
                422,
                __('portal.not_deliverable'),
            );

            $version = $project->files()->where('category', ProjectFile::CATEGORY_DELIVERABLE)->count() + 1;
            $path = $upload->store("projects/{$project->id}/deliverable", 'local');

            $project->files()->create([
                'category' => ProjectFile::CATEGORY_DELIVERABLE,
                'uploaded_by' => $translator->id,
                'original_name' => $upload->getClientOriginalName(),
                'disk_path' => $path,
                'mime_type' => $upload->getClientMimeType(),
                'size_bytes' => $upload->getSize(),
                'count_status' => ProjectFile::COUNT_NOT_APPLICABLE,
                'version' => $version,
            ]);

            $windowStart = $project->status === Project::STATUS_REVISION_REQUESTED
                ? $project->transitions()
                    ->where('to_status', Project::STATUS_REVISION_REQUESTED)
                    ->latest('created_at')->value('created_at') ?? $assignment->claimed_at
                : $assignment->claimed_at;

            $this->transitions->transition($project, Project::STATUS_DELIVERED, $translator);

            $assignment->update([
                'status' => Assignment::STATUS_DELIVERED,
                'delivered_at' => now(),
                'work_seconds' => ($assignment->work_seconds ?? 0)
                    + (int) round(now()->diffInSeconds($windowStart, true)),
            ]);

            return $assignment->fresh();
        });
    }

    /** The assignment the translator must work on now (fresh claim or pending revision). */
    public function currentAssignment(User $translator): ?Assignment
    {
        return Assignment::query()
            ->where('translator_id', $translator->id)
            ->where(function ($query): void {
                $query->where('status', Assignment::STATUS_ACTIVE)
                    ->orWhere(fn ($q) => $q
                        ->where('status', Assignment::STATUS_DELIVERED)
                        ->whereHas('project', fn ($p) => $p->where('status', Project::STATUS_REVISION_REQUESTED)));
            })
            ->with(['project.sourceLanguage', 'project.targetLanguage', 'project.files.uploader:id,name'])
            ->latest('claimed_at')
            ->first();
    }

    /** Latest revision note for a project awaiting rework. */
    public function revisionNote(Project $project): ?StatusTransition
    {
        if ($project->status !== Project::STATUS_REVISION_REQUESTED) {
            return null;
        }

        return $project->transitions()
            ->where('to_status', Project::STATUS_REVISION_REQUESTED)
            ->with('actor:id,name')
            ->latest('created_at')
            ->first();
    }

    /** @throws ClaimConflictException */
    private function assertNotBusy(User $translator): void
    {
        $busy = Assignment::query()
            ->where('translator_id', $translator->id)
            ->where(function ($query): void {
                $query->where('status', Assignment::STATUS_ACTIVE)
                    ->orWhere(fn ($q) => $q
                        ->where('status', Assignment::STATUS_DELIVERED)
                        ->whereHas('project', fn ($p) => $p->where('status', Project::STATUS_REVISION_REQUESTED)));
            })
            ->exists();

        if ($busy) {
            throw new ClaimConflictException(__('portal.finish_current_first'));
        }
    }
}
