<?php

namespace App\Jobs;

use App\Models\Project;
use App\Models\ProjectFile;
use App\Services\ProjectTransitionService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * approved → completed (system transition).
 *
 * M9a: the letterhead + stamp the PM chose at approval are resolved here and
 * logged, but the latest deliverable is still copied verbatim as the final file.
 * M9b swaps ONLY the copy step below for the Gotenberg + FPDI overlay (the
 * templates and their normalized `placement` config are already in hand) — the
 * review flow and the approved→completed transition stay untouched.
 */
class FinalizeProjectJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 2;

    public function __construct(public Project $project) {}

    public function handle(ProjectTransitionService $transitions): void
    {
        $project = $this->project->fresh();

        if (! $project || $project->status !== Project::STATUS_APPROVED) {
            return;
        }

        $project->load(['letterhead', 'stamp']);

        $deliverable = $project->files()
            ->where('category', ProjectFile::CATEGORY_DELIVERABLE)
            ->latest('version')
            ->firstOrFail();

        Log::info('Finalizing project', [
            'project' => $project->code,
            'deliverable_file_id' => $deliverable->id,
            'letterhead' => $project->letterhead?->only(['id', 'name', 'disk_path', 'placement']),
            'stamp' => $project->stamp?->only(['id', 'name', 'disk_path', 'placement']),
        ]);

        // ── M9b merge seam ────────────────────────────────────────────────
        // Replace the copy below with: deliverable → PDF (Gotenberg) → FPDI
        // overlay of $project->letterhead / $project->stamp per their
        // `placement` (see App\Support\PlacementConfig) → store as `final`.
        $extension = pathinfo($deliverable->original_name, PATHINFO_EXTENSION);
        $finalPath = "projects/{$project->id}/final/{$project->code}-final.{$extension}";

        Storage::disk('local')->copy($deliverable->disk_path, $finalPath);

        $project->files()->create([
            'category' => ProjectFile::CATEGORY_FINAL,
            'uploaded_by' => $deliverable->uploaded_by,
            'original_name' => "{$project->code}-final.{$extension}",
            'disk_path' => $finalPath,
            'mime_type' => $deliverable->mime_type,
            'size_bytes' => $deliverable->size_bytes,
            'count_status' => ProjectFile::COUNT_NOT_APPLICABLE,
        ]);

        $transitions->transition($project, Project::STATUS_COMPLETED, null);
    }
}
