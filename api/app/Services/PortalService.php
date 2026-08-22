<?php

namespace App\Services;

use App\Exceptions\ClaimConflictException;
use App\Jobs\CountWordsJob;
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
     * Every available project, for every translator.
     *
     * The queue used to be filtered to the translator's registered language
     * pairs. The office asked for the opposite: publishing makes a file visible
     * to the whole translation team regardless of pair, and translators pick
     * for themselves — so the pair is a filter they apply, not a wall. Ordering
     * stays server-enforced: urgent first, then nearest deadline.
     *
     * @param  array<string, mixed>  $filters
     */
    public function queueFor(User $translator, array $filters = [])
    {
        return Project::query()
            ->where('status', Project::STATUS_AVAILABLE)
            ->when(
                filled($filters['search'] ?? null),
                fn ($q) => $q->where(function ($w) use ($filters): void {
                    $term = '%'.str_replace(['%', '_'], ['\%', '\_'], (string) $filters['search']).'%';
                    $w->where('title', 'ilike', $term)->orWhere('code', 'ilike', $term);
                }),
            )
            ->when(filled($filters['priority'] ?? null), fn ($q) => $q->where('priority', $filters['priority']))
            ->when(filled($filters['service_type'] ?? null), fn ($q) => $q->where('service_type', $filters['service_type']))
            ->when(filled($filters['source_language_id'] ?? null), fn ($q) => $q->where('source_language_id', $filters['source_language_id']))
            ->when(filled($filters['target_language_id'] ?? null), fn ($q) => $q->where('target_language_id', $filters['target_language_id']))
            // "Mine" is now opt-in: the pairs the translator registered, on demand.
            ->when(
                filled($filters['my_pairs'] ?? null) && filter_var($filters['my_pairs'], FILTER_VALIDATE_BOOLEAN),
                fn ($q) => $q->whereIn(
                    DB::raw('(source_language_id, target_language_id)'),
                    $translator->languagePairs()
                        ->select('source_language_id', 'target_language_id')
                        ->getQuery(),
                ),
            )
            // File metadata rides along so a translator can judge a file before
            // taking it. Only metadata — downloadFile() still refuses anything
            // outside the project they currently hold.
            ->with([
                'sourceLanguage',
                'targetLanguage',
                'files' => fn ($q) => $q
                    ->whereIn('category', [ProjectFile::CATEGORY_SOURCE, ProjectFile::CATEGORY_REFERENCE])
                    ->orderBy('category')
                    ->orderBy('id'),
            ])
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

                // No language-pair check: if a file is visible in the queue it is
                // claimable. Gating the claim while showing the card would only
                // produce a button that always fails. The one-at-a-time rule in
                // assertNotBusy() is what still protects the queue.
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
    /**
     * @param  list<UploadedFile>  $uploads  one delivery round; a visa application can
     *                                       carry a passport, a licence and a contract
     * @param  array<int, array|null>  $stampPlacements  where the translator dragged the
     *                                                   seal on each upload, keyed by the
     *                                                   same index. Already normalized by
     *                                                   the controller; a missing entry
     *                                                   leaves the stamp template's own
     *                                                   position in charge.
     */
    public function deliver(User $translator, array $uploads, array $stampPlacements = []): Assignment
    {
        return DB::transaction(function () use ($translator, $uploads, $stampPlacements): Assignment {
            $assignment = $this->currentAssignment($translator);

            abort_if($assignment === null, 404, __('portal.no_active_assignment'));

            /** @var Project $project */
            $project = Project::whereKey($assignment->project_id)->lockForUpdate()->firstOrFail();

            abort_unless(
                in_array($project->status, [Project::STATUS_CLAIMED, Project::STATUS_REVISION_REQUESTED], true),
                422,
                __('portal.not_deliverable'),
            );

            // One delivery is one round, however many files it carries, so they all
            // share a version. The merge keys off that: it letterheads every file of
            // the newest round and would otherwise mix a re-delivery with the round
            // it replaces.
            $version = ($project->files()->where('category', ProjectFile::CATEGORY_DELIVERABLE)->max('version') ?? 0) + 1;

            foreach ($uploads as $index => $upload) {
                $deliverable = $project->files()->create([
                    'category' => ProjectFile::CATEGORY_DELIVERABLE,
                    'uploaded_by' => $translator->id,
                    'original_name' => $upload->getClientOriginalName(),
                    'disk_path' => $upload->store("projects/{$project->id}/deliverable", 'local'),
                    'mime_type' => $upload->getClientMimeType(),
                    'size_bytes' => $upload->getSize(),
                    'version' => $version,
                    // Where this document's seal goes. Per file, because the blank
                    // space on a passport is nowhere near the blank space on a lease.
                    'stamp_placement' => $stampPlacements[$index] ?? null,
                ]);

                // The delivered file is counted like any other upload. It used to be
                // written straight to `not_applicable`, so a translator's output never
                // carried a word count even when it was a .docx the counter reads
                // perfectly — which is what the office reported as "the system does not
                // calculate the words". Queued after commit so the count runs against a
                // row that exists.
                CountWordsJob::dispatch($deliverable)->afterCommit();
            }

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
            ->with(['actor:id,name', 'attachments'])
            ->latest('created_at')
            ->latest('id')
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
