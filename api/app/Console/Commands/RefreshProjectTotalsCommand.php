<?php

namespace App\Console\Commands;

use App\Models\Project;
use App\Models\ProjectFile;
use App\Services\DocumentCounter;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * Backfill for the delivered totals (2026-09-05): projects merged before the
 * change hold final PDFs with no page count, and every project's delivered_*
 * columns start empty. New merges and new counts maintain both from now on
 * (MergeFinalFileJob, CountWordsJob); this catches up what is already stored.
 *
 *   php artisan projects:refresh-totals --dry-run   # report only
 *   php artisan projects:refresh-totals             # write
 *
 * Run via `compose run --rm` or `exec -u www-data`, never bare `exec` — the
 * queue writes those files as www-data and root-owned rows have bitten before.
 */
class RefreshProjectTotalsCommand extends Command
{
    protected $signature = 'projects:refresh-totals
                            {--dry-run : Report what would change without writing}';

    protected $description = 'Fill missing final-PDF page counts and recompute source + delivered totals';

    public function handle(DocumentCounter $counter): int
    {
        $dry = (bool) $this->option('dry-run');

        // Finals first: refreshTotals() prefers their pages over the deliverables'.
        $finals = ProjectFile::query()
            ->where('category', ProjectFile::CATEGORY_FINAL)
            ->whereNull('page_count')
            ->get();

        foreach ($finals as $final) {
            if (! Storage::disk('local')->exists($final->disk_path)) {
                $this->warn("missing on disk, skipped: {$final->disk_path}");

                continue;
            }

            $pages = $counter->pdfPageCount((string) Storage::disk('local')->get($final->disk_path));

            $this->line(sprintf(
                '%s: %s ⇒ %s pages',
                $dry ? 'would fill' : 'filled',
                $final->original_name,
                $pages ?? '?',
            ));

            if (! $dry && $pages !== null) {
                $final->update(['page_count' => $pages]);
            }
        }

        if ($dry) {
            $this->info("dry run: {$finals->count()} final file(s) checked, no totals written.");

            return self::SUCCESS;
        }

        Project::query()->withTrashed()->each(function (Project $project): void {
            $project->refreshTotals();
        });

        $this->info(sprintf(
            'done: %d final file(s) checked, totals refreshed for %d project(s).',
            $finals->count(),
            Project::withTrashed()->count(),
        ));

        return self::SUCCESS;
    }
}
