<?php

namespace App\Console\Commands;

use App\Models\LetterheadTemplate;
use App\Support\AssetOptimizer;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * Shrink letterhead artwork that was uploaded before the optimiser existed.
 *
 * New uploads are optimised on the way in (LetterheadController::storeAsset), but
 * the templates already in production are the ones costing the client bytes today —
 * a 17.6 MB scanned letterhead is redrawn into every delivery.
 *
 *   php artisan letterheads:optimize --dry-run   # report only, touches nothing
 *   php artisan letterheads:optimize             # rewrite, keeping .orig backups
 *   php artisan letterheads:optimize --restore   # put the originals back
 *
 * Every rewrite leaves `<path>.orig` beside the asset. This is a client's official
 * certified-translation artwork: it has to be possible to look at the result, decide
 * it lost too much, and get the exact original bytes back.
 */
class OptimizeLetterheadsCommand extends Command
{
    protected $signature = 'letterheads:optimize
                            {--dry-run : Report the saving without writing anything}
                            {--restore : Restore every .orig backup and exit}
                            {--id=* : Limit to these template ids}';

    protected $description = 'Downsample letterhead and stamp artwork so deliveries stop carrying full-resolution scans';

    public function handle(): int
    {
        if ($this->option('restore')) {
            return $this->restore();
        }

        $dryRun = (bool) $this->option('dry-run');

        if (! $dryRun && ! AssetOptimizer::supportsPdf()) {
            $this->warn('ghostscript is not installed — PDF templates will be skipped, images still processed.');
        }

        $templates = LetterheadTemplate::query()
            ->when($this->option('id'), fn ($query, $ids) => $query->whereIn('id', $ids))
            ->orderBy('id')
            ->get();

        if ($templates->isEmpty()) {
            $this->info('No templates to process.');

            return self::SUCCESS;
        }

        $rows = [];
        $totalBefore = 0;
        $totalAfter = 0;

        foreach ($templates as $template) {
            $disk = Storage::disk('local');

            if (! $disk->exists($template->disk_path)) {
                $rows[] = [$template->id, $template->name, $template->kind, '—', '—', 'missing'];

                continue;
            }

            $absolute = $disk->path($template->disk_path);
            $before = (int) filesize($absolute);
            $totalBefore += $before;

            if ($dryRun) {
                // Measure on a copy so a dry run cannot mutate anything. The copy has
                // to keep the original extension — the optimiser dispatches on it, and
                // a `.pdf.probe` file silently reports "no change" for everything.
                $extension = pathinfo($absolute, PATHINFO_EXTENSION);
                $probe = $absolute.'.probe.'.$extension;
                copy($absolute, $probe);
                $result = AssetOptimizer::optimize($probe);
                @unlink($probe);
            } else {
                $backup = $absolute.'.orig';

                if (! is_file($backup)) {
                    copy($absolute, $backup);
                }

                $result = AssetOptimizer::optimize($absolute);
            }

            $totalAfter += $result['after'];
            $rows[] = [
                $template->id,
                mb_strimwidth($template->name, 0, 24, '…'),
                $template->kind,
                $this->bytes($result['before']),
                $this->bytes($result['after']),
                $result['applied'] ? $this->saving($result['before'], $result['after']) : 'no change',
            ];
        }

        $this->table(['id', 'name', 'kind', 'before', 'after', 'saved'], $rows);

        $this->line('');
        $this->info(sprintf(
            '%s: %s → %s (%s)',
            $dryRun ? 'Would save' : 'Saved',
            $this->bytes($totalBefore),
            $this->bytes($totalAfter),
            $this->saving($totalBefore, $totalAfter),
        ));

        if ($dryRun) {
            $this->comment('Dry run — nothing was written. Re-run without --dry-run to apply.');
        } else {
            $this->comment('Originals kept as <path>.orig — `--restore` puts them back.');
            $this->comment('Existing final files are NOT re-merged; only new merges pick this up.');
        }

        return self::SUCCESS;
    }

    private function restore(): int
    {
        $disk = Storage::disk('local');
        $restored = 0;

        foreach (LetterheadTemplate::orderBy('id')->get() as $template) {
            $absolute = $disk->path($template->disk_path);
            $backup = $absolute.'.orig';

            if (is_file($backup)) {
                copy($backup, $absolute);
                @unlink($backup);
                $restored++;
                $this->line("restored #{$template->id} {$template->name}");
            }
        }

        $this->info("{$restored} template(s) restored.");

        return self::SUCCESS;
    }

    private function saving(int $before, int $after): string
    {
        if ($before <= 0 || $after >= $before) {
            return '0%';
        }

        return sprintf('−%d%%', (int) round((($before - $after) / $before) * 100));
    }

    private function bytes(int $value): string
    {
        if ($value >= 1048576) {
            return sprintf('%.1f MB', $value / 1048576);
        }

        return $value >= 1024 ? sprintf('%.0f KB', $value / 1024) : "{$value} B";
    }
}
