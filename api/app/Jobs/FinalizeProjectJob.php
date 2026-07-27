<?php

namespace App\Jobs;

use App\Models\Project;
use App\Models\ProjectFile;
use App\Services\ProjectTransitionService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Storage;

/**
 * approved → completed (system transition).
 *
 * Sprint 3: the latest deliverable is copied as the final file.
 * Sprint 4 (M9) replaces the copy step with the Gotenberg + FPDI
 * letterhead/stamp merge pipeline once client templates arrive.
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

        $deliverable = $project->files()
            ->where('category', ProjectFile::CATEGORY_DELIVERABLE)
            ->latest('version')
            ->firstOrFail();

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
