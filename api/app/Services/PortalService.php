<?php

namespace App\Services;

use App\Exceptions\ClaimConflictException;
use App\Jobs\CountWordsJob;
use App\Models\Assignment;
use App\Models\Project;
use App\Models\ProjectFile;
use App\Models\StatusTransition;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

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
                // `current()`: a superseded supporting document is one the office
                // rejected, and a translator has no way to tell two ID cards apart.
                'files' => fn ($q) => $q
                    ->whereIn('category', [ProjectFile::CATEGORY_SOURCE, ProjectFile::CATEGORY_REFERENCE])
                    ->current()
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
     * @param  array<int, array<int, array>>  $stampPlacements  where the translator dragged
     *                                                         each seal on each upload:
     *                                                         upload index → stamp id →
     *                                                         position. Already sanitized
     *                                                         by the controller; a seal
     *                                                         with no entry keeps its
     *                                                         template's own position.
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
                    // Where this document's seals go. Per file, because the blank
                    // space on a passport is nowhere near the blank space on a lease.
                    'stamp_placements' => ($stampPlacements[$index] ?? []) ?: null,
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
                ? $project->transitionsTo(Project::STATUS_REVISION_REQUESTED)->value('created_at') ?? $assignment->claimed_at
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

    /**
     * Deliveries the translator can still change: handed over, not yet opened by the
     * PM (docs/02 rule 6). Carries the newest round's files only — an earlier round is
     * what a revision note was written about, and it is not theirs to rewrite.
     *
     * @return Collection<int, Assignment>
     */
    public function awaitingReview(User $translator): Collection
    {
        return $this->awaitingReviewQuery($translator)->latest('delivered_at')->get();
    }

    /**
     * Change a delivery the PM has not opened yet: add files to it, or swap one of its
     * files for the right one when `$replaces` is given.
     *
     * The files join the round they correct instead of starting a new one. This is the
     * translator fixing what they handed over, not a revision cycle — a new version
     * would read as one, and the merge would drop the files the translator kept. The
     * clock stays stopped: waiting for a review is not work.
     *
     * @param  list<UploadedFile>  $uploads
     * @param  array<int, array<int, array>>  $stampPlacements  keyed by upload index, as in deliver()
     */
    public function amendDelivery(
        User $translator,
        Project $project,
        array $uploads,
        array $stampPlacements = [],
        ?int $replaces = null,
    ): Assignment {
        $replaced = DB::transaction(function () use ($translator, $project, $uploads, $stampPlacements, $replaces): ?ProjectFile {
            [$project, $round] = $this->lockAmendableDelivery($translator, $project);

            $replaced = $replaces !== null ? $this->roundFile($project, $round, $replaces) : null;
            $replaced?->delete();

            $added = [];

            foreach ($uploads as $index => $upload) {
                $file = $project->files()->create([
                    'category' => ProjectFile::CATEGORY_DELIVERABLE,
                    'uploaded_by' => $translator->id,
                    'original_name' => $upload->getClientOriginalName(),
                    'disk_path' => $upload->store("projects/{$project->id}/deliverable", 'local'),
                    'mime_type' => $upload->getClientMimeType(),
                    'size_bytes' => $upload->getSize(),
                    'version' => $round,
                    'stamp_placements' => ($stampPlacements[$index] ?? []) ?: null,
                ]);

                CountWordsJob::dispatch($file)->afterCommit();
                $added[] = $file->original_name;
            }

            // The replaced file's count leaves the delivered totals now; the new file's
            // arrives when its count job lands.
            $project->refreshTotals();
            $this->logAmendment($project, $translator, $replaced ? [$replaced->original_name] : [], $added);

            return $replaced;
        });

        // After commit: a rolled-back swap must still find the file it was going to replace.
        if ($replaced !== null) {
            Storage::disk('local')->delete($replaced->disk_path);
        }

        return $this->awaitingReviewQuery($translator)->where('project_id', $project->id)->firstOrFail();
    }

    /**
     * Take one file out of a delivery the PM has not opened yet — the extra document
     * that was never meant to go. Never the last one: a delivered project with nothing
     * delivered would reach review empty. The way to fix a lone wrong file is to
     * replace it.
     */
    public function removeDeliveredFile(User $translator, Project $project, int $fileId): Assignment
    {
        $removed = DB::transaction(function () use ($translator, $project, $fileId): ProjectFile {
            [$project, $round] = $this->lockAmendableDelivery($translator, $project);

            $file = $this->roundFile($project, $round, $fileId);

            abort_if(
                $project->files()
                    ->where('category', ProjectFile::CATEGORY_DELIVERABLE)
                    ->where('version', $round)
                    ->count() === 1,
                422,
                __('portal.delivery_last_file'),
            );

            $file->delete();
            $project->refreshTotals();
            $this->logAmendment($project, $translator, [$file->original_name], []);

            return $file;
        });

        Storage::disk('local')->delete($removed->disk_path);

        return $this->awaitingReviewQuery($translator)->where('project_id', $project->id)->firstOrFail();
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
            ->with([
                'project.sourceLanguage',
                'project.targetLanguage',
                // `current()`: the file the office rejected must not sit in the
                // translator's list beside the one that replaced it.
                'project.files' => fn ($query) => $query->current()->with('uploader:id,name'),
            ])
            ->latest('claimed_at')
            ->first();
    }

    /** Latest revision note for a project awaiting rework. */
    public function revisionNote(Project $project): ?StatusTransition
    {
        if ($project->status !== Project::STATUS_REVISION_REQUESTED) {
            return null;
        }

        return $project->transitionsTo(Project::STATUS_REVISION_REQUESTED)
            ->with(['actor:id,name', 'attachments'])
            ->first();
    }

    /** @return Builder<Assignment> */
    private function awaitingReviewQuery(User $translator): Builder
    {
        return Assignment::query()
            ->where('translator_id', $translator->id)
            ->where('status', Assignment::STATUS_DELIVERED)
            ->whereHas('project', fn ($query) => $query->where('status', Project::STATUS_DELIVERED))
            ->with([
                'project.sourceLanguage',
                'project.targetLanguage',
                'project.files' => fn ($query) => $query
                    ->where('category', ProjectFile::CATEGORY_DELIVERABLE)
                    ->whereRaw(
                        'project_files.version = (SELECT MAX(round.version) FROM project_files AS round WHERE round.project_id = project_files.project_id AND round.category = ?)',
                        [ProjectFile::CATEGORY_DELIVERABLE],
                    )
                    ->orderBy('id'),
            ]);
    }

    /**
     * Lock the project and confirm the delivery is still this translator's to change.
     *
     * The row lock is what makes "until the PM opens the review" exact: opening it is
     * a transition, and every transition takes the same lock. Whichever lands second
     * sees the other — the translator never swaps a file the PM is already reading.
     *
     * @return array{0: Project, 1: int} the locked project and its newest round
     */
    private function lockAmendableDelivery(User $translator, Project $project): array
    {
        /** @var Project $fresh */
        $fresh = Project::whereKey($project->getKey())->lockForUpdate()->firstOrFail();

        // Someone else's delivery is answered like a project that does not exist.
        abort_unless(
            $fresh->assignments()
                ->where('translator_id', $translator->id)
                ->where('status', Assignment::STATUS_DELIVERED)
                ->exists(),
            404,
        );

        abort_unless($fresh->status === Project::STATUS_DELIVERED, 422, __('portal.delivery_locked'));

        $round = (int) $fresh->files()->where('category', ProjectFile::CATEGORY_DELIVERABLE)->max('version');

        return [$fresh, $round];
    }

    /** A file of the newest delivery round, or 404 — never a file from a round already reviewed. */
    private function roundFile(Project $project, int $round, int $fileId): ProjectFile
    {
        return $project->files()
            ->where('category', ProjectFile::CATEGORY_DELIVERABLE)
            ->where('version', $round)
            ->whereKey($fileId)
            ->firstOrFail();
    }

    /**
     * On the audit trail, in the shape the activity screen already renders: what the
     * delivery lost as `old`, what it gained as `attributes`. Files have no log of
     * their own, and without this the PM would find a different document than the one
     * they were notified about with nothing to say why.
     *
     * @param  list<string>  $removed
     * @param  list<string>  $added
     */
    private function logAmendment(Project $project, User $translator, array $removed, array $added): void
    {
        activity('projects')
            ->performedOn($project)
            ->causedBy($translator)
            ->event('updated')
            ->withProperties([
                'old' => ['deliverable' => $removed === [] ? null : implode('، ', $removed)],
                'attributes' => ['deliverable' => $added === [] ? null : implode('، ', $added)],
            ])
            ->log('delivery_amended');
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
