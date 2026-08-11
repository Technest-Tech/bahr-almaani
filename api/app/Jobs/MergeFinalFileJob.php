<?php

namespace App\Jobs;

use App\Models\Project;
use App\Models\ProjectFile;
use App\Models\User;
use App\Notifications\MergeFailedNotification;
use App\Notifications\ProjectCompletedNotification;
use App\Services\DocumentMergeService;
use App\Services\ProjectTransitionService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Throwable;

/**
 * approved → completed (system transition), via the M9b letterhead + stamp merge.
 *
 * The PM's letterhead/stamp selection is already on the project (ReviewController::approve),
 * so this job only has to render. On failure the project STAYS `approved` with the reason
 * recorded — docs/02 edge case 3 — and the PM retries from the project page.
 */
class MergeFinalFileJob implements ShouldQueue
{
    use Queueable;

    /** One attempt: a retry is an explicit human decision, not an automatic replay. */
    public int $tries = 1;

    public int $timeout = 180;

    public function __construct(public Project $project) {}

    public function handle(ProjectTransitionService $transitions, DocumentMergeService $merger): void
    {
        $project = $this->project->fresh();

        if (! $project || $project->status !== Project::STATUS_APPROVED) {
            return;
        }

        $project->load(['letterhead', 'stamp', 'creator']);

        $deliverable = $project->files()
            ->where('category', ProjectFile::CATEGORY_DELIVERABLE)
            ->latest('version')
            ->firstOrFail();

        $project->forceFill([
            'merge_attempted_at' => now(),
            'merge_attempts' => $project->merge_attempts + 1,
        ])->saveQuietly();

        try {
            $pdf = $merger->mergeStoredFile(
                $deliverable->disk_path,
                $deliverable->original_name,
                $project->letterhead,
                $project->stamp,
            );

            // Re-merging after a retry must not accumulate final files.
            $this->discardPreviousFinals($project);

            // The path stays code-based: it is a filesystem location, and a
            // client-supplied name has no business in one.
            $finalPath = "projects/{$project->id}/final/{$project->code}-final.pdf";
            Storage::disk('local')->put($finalPath, $pdf);

            $project->files()->create([
                'category' => ProjectFile::CATEGORY_FINAL,
                'uploaded_by' => $deliverable->uploaded_by,
                'original_name' => $this->deliveredName($project),
                'disk_path' => $finalPath,
                'mime_type' => 'application/pdf',
                'size_bytes' => strlen($pdf),
                'count_status' => ProjectFile::COUNT_NOT_APPLICABLE,
            ]);

            $project->forceFill(['merge_error' => null])->saveQuietly();

            $transitions->transition($project, Project::STATUS_COMPLETED, null);

            Notification::send(
                $this->watchers($project),
                new ProjectCompletedNotification($project->fresh()),
            );
        } catch (Throwable $e) {
            // Deliberately not rethrown: a merge failure is a business outcome the
            // state machine models (project stays `approved`, watchers notified,
            // retry button appears), not a job that needs replaying. Rethrowing
            // would also 500 the PM's approve request on a sync queue.
            $this->recordFailure($project, $e);
        }
    }

    /** Queue-level failure (timeout, worker kill) still has to notify and leave a reason. */
    public function failed(Throwable $e): void
    {
        $project = $this->project->fresh();

        if ($project && $project->status === Project::STATUS_APPROVED && blank($project->merge_error)) {
            $this->recordFailure($project, $e);
        }
    }

    private function recordFailure(Project $project, Throwable $e): void
    {
        Log::error('Letterhead merge failed', [
            'project' => $project->code,
            'letterhead_id' => $project->letterhead_id,
            'stamp_id' => $project->stamp_id,
            'error' => $e->getMessage(),
            // Full trace here is the only record — the job does not fail the queue.
            'exception' => $e,
        ]);

        $project->forceFill(['merge_error' => Str::limit($e->getMessage(), 1000)])->saveQuietly();

        Notification::send(
            $this->watchers($project),
            new MergeFailedNotification($project, $e->getMessage()),
        );
    }

    /** The project's PM plus every admin — docs/02 notification matrix. */
    private function watchers(Project $project): Collection
    {
        return User::role('admin')
            ->where('status', User::STATUS_ACTIVE)
            ->with('notificationPreferences')
            ->get()
            ->concat(array_filter([$project->creator]))
            ->unique('id')
            ->values();
    }

    /**
     * The client gets back the name they sent in.
     *
     * They identify a job by the filename they emailed over, so `BM-2026-00004-final.pdf`
     * forces them to cross-reference a code they never use. The basename comes from the
     * first source file; the extension is always .pdf because the merge rasterises
     * everything through Gotenberg — a .docx cannot come back as a .docx with a
     * letterhead burned into it. A project with no source file (all-reference, or the
     * sources were deleted) falls back to the project code.
     *
     * Only ever used as a Content-Disposition name, never as a path — see $finalPath.
     */
    private function deliveredName(Project $project): string
    {
        $source = $project->files()
            ->where('category', ProjectFile::CATEGORY_SOURCE)
            ->orderBy('id')
            ->value('original_name');

        $base = trim(pathinfo((string) $source, PATHINFO_FILENAME));

        return $base === '' ? "{$project->code}-final.pdf" : "{$base}.pdf";
    }

    private function discardPreviousFinals(Project $project): void
    {
        $previous = $project->files()->where('category', ProjectFile::CATEGORY_FINAL)->get();

        foreach ($previous as $file) {
            Storage::disk('local')->delete($file->disk_path);
            $file->delete();
        }
    }
}
