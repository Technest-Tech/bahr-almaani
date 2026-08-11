<?php

namespace App\Jobs;

use App\Models\ProjectFile;
use App\Services\DocumentCounter;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Storage;

class CountWordsJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 2;

    public function __construct(public ProjectFile $file) {}

    public function handle(DocumentCounter $counter): void
    {
        $file = $this->file->fresh();

        if (! $file || $file->count_source === 'manual') {
            return; // deleted meanwhile, or a manual count already took precedence
        }

        $file->update(['count_status' => ProjectFile::COUNT_PROCESSING]);

        $extension = pathinfo($file->original_name, PATHINFO_EXTENSION);
        $result = $counter->count(Storage::disk('local')->path($file->disk_path), $extension);

        $file->update([
            'word_count' => $result['words'],
            'page_count' => $result['pages'],
            'char_count' => $result['chars'],
            'count_status' => $result['countable']
                ? ProjectFile::COUNT_DONE
                : ProjectFile::COUNT_NOT_APPLICABLE,
            'count_source' => 'auto',
        ]);

        $file->project->refreshTotals();
    }

    public function failed(): void
    {
        $this->file->fresh()?->update(['count_status' => ProjectFile::COUNT_FAILED]);
    }
}
