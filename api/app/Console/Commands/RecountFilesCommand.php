<?php

namespace App\Console\Commands;

use App\Models\Project;
use App\Models\ProjectFile;
use App\Services\DocumentCounter;
use App\Services\OcrCounter;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * Re-run word/page counting over files already in the system.
 *
 * Deliverables were written straight to `not_applicable` and never counted, so
 * every translator's output in production carries no word count even when it is a
 * .docx the counter reads perfectly. New uploads are fixed at the source
 * (PortalService::deliver); this catches up the ones already stored.
 *
 *   php artisan files:recount --dry-run              # report only
 *   php artisan files:recount                        # write counts
 *   php artisan files:recount --category=deliverable # limit to one category
 *   php artisan files:recount --ocr                  # also OCR scans/photos (slow)
 *
 * A manual count always wins, --force included: if someone typed a number for a
 * scan, re-running this must never replace it with the machine's opinion. An OCR
 * estimate is protected one step less: --force alone keeps it (text extraction
 * would only wipe it back to nothing), --force --ocr re-estimates it.
 */
class RecountFilesCommand extends Command
{
    protected $signature = 'files:recount
                            {--dry-run : Report what would change without writing}
                            {--category=* : Limit to these categories (default: source, deliverable)}
                            {--force : Also re-read files that already carry an automatic count}
                            {--ocr : OCR scans and images that have no text layer (estimates, stored as count_source=ocr)}';

    protected $description = 'Re-run word and page counting over stored project files';

    public function handle(DocumentCounter $counter, OcrCounter $ocr): int
    {
        $categories = $this->option('category') ?: [
            ProjectFile::CATEGORY_SOURCE,
            ProjectFile::CATEGORY_DELIVERABLE,
        ];

        $useOcr = (bool) $this->option('ocr');

        if ($useOcr && ! $ocr->available()) {
            $this->error('The tesseract binary is not installed in this container — --ocr cannot run.');

            return self::FAILURE;
        }

        // A manual count always wins, --force included. Someone typed that number
        // off a scan the machine cannot read; replacing it with the machine's
        // opinion would silently destroy the only correct figure in the project.
        // --force only re-reads files whose count came from an earlier auto run.
        $files = ProjectFile::query()
            ->whereIn('category', $categories)
            ->where('count_source', '!=', 'manual')
            ->when(
                ! $this->option('force'),
                fn ($query) => $query->whereIn('count_status', [
                    ProjectFile::COUNT_PENDING,
                    ProjectFile::COUNT_NOT_APPLICABLE,
                    ProjectFile::COUNT_FAILED,
                ]),
            )
            ->orderBy('id')
            ->get();

        $dryRun = (bool) $this->option('dry-run');
        $rows = [];
        $counted = 0;
        $words = 0;
        $projects = collect();

        foreach ($files as $file) {
            if (! Storage::disk('local')->exists($file->disk_path)) {
                $rows[] = [$file->id, $file->category, $this->name($file), '—', 'missing from disk'];

                continue;
            }

            $path = Storage::disk('local')->path($file->disk_path);
            $extension = pathinfo($file->original_name, PATHINFO_EXTENSION);
            $result = $counter->count($path, $extension);
            $source = 'auto';

            if (! $result['countable'] && $useOcr && OcrCounter::supports($extension)) {
                $estimate = $ocr->count($path, $extension);

                if ($estimate['countable']) {
                    $estimate['pages'] ??= $result['pages'];
                    $result = $estimate;
                    $source = 'ocr';
                } else {
                    $result['pages'] ??= $estimate['pages'];
                }
            }

            // Without --ocr, a --force pass over an OCR-estimated file only sees
            // "no text layer" — writing that would wipe a good estimate to nothing.
            if (! $result['countable'] && $file->count_source === 'ocr' && ! $useOcr) {
                $rows[] = [$file->id, $file->category, $this->name($file), $file->count_status, 'kept OCR estimate (use --ocr to refresh)'];

                continue;
            }

            $outcome = match (true) {
                $result['countable'] && $source === 'ocr' => sprintf('≈ %s words (OCR)', number_format((int) $result['words'])),
                $result['countable'] => sprintf('%s words', number_format((int) $result['words'])),
                default => 'not countable (scan → needs OCR or manual entry)',
            };

            $rows[] = [
                $file->id,
                $file->category,
                $this->name($file),
                $file->count_status,
                $outcome,
            ];

            if ($result['countable']) {
                $counted++;
                $words += (int) $result['words'];
            }

            if (! $dryRun) {
                $file->update([
                    'word_count' => $result['words'],
                    'page_count' => $result['pages'] ?? $file->page_count,
                    'char_count' => $result['chars'],
                    'count_status' => $result['countable']
                        ? ProjectFile::COUNT_DONE
                        : ProjectFile::COUNT_NOT_APPLICABLE,
                    'count_source' => $source,
                ]);
                $projects->push($file->project_id);
            }
        }

        $this->table(['id', 'category', 'file', 'was', 'now'], $rows);

        // Project totals are cached on the row; a recount that skipped this would
        // leave the reports still reading zero.
        $projects->unique()->each(function (int $id): void {
            Project::find($id)?->refreshTotals();
        });

        $this->line('');
        $this->info(sprintf(
            '%s %d of %d file(s), %s words total.',
            $dryRun ? 'Would count' : 'Counted',
            $counted,
            $files->count(),
            number_format($words),
        ));

        $uncountable = $files->count() - $counted;

        if ($uncountable > 0) {
            $this->warn($useOcr
                ? sprintf('%d file(s) could not be read reliably even with OCR. Those need a manual entry from the project page.', $uncountable)
                : sprintf('%d file(s) have no text layer. Re-run with --ocr to estimate them, or enter counts manually from the project page.', $uncountable));
        }

        if ($dryRun) {
            $this->comment('Dry run — nothing was written.');
        }

        return self::SUCCESS;
    }

    private function name(ProjectFile $file): string
    {
        return mb_strimwidth($file->original_name, 0, 30, '…');
    }
}
