<?php

namespace App\Jobs;

use App\Models\ProjectFile;
use App\Services\DocumentCounter;
use App\Services\OcrCounter;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Storage;

class CountWordsJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 2;

    /** OCR of a multi-page scan is minutes, not seconds; stay under queue:work --timeout=300. */
    public int $timeout = 280;

    public function __construct(public ProjectFile $file) {}

    public function handle(DocumentCounter $counter, OcrCounter $ocr): void
    {
        $file = $this->file->fresh();

        if (! $file || $file->count_source === 'manual') {
            return; // deleted meanwhile, or a manual count already took precedence
        }

        $file->update(['count_status' => ProjectFile::COUNT_PROCESSING]);

        $extension = pathinfo($file->original_name, PATHINFO_EXTENSION);
        $path = Storage::disk('local')->path($file->disk_path);
        $result = $counter->count($path, $extension);
        $source = 'auto';

        // No text layer ⇒ scan or photo: OCR is the second opinion. Its numbers
        // are estimates, stored as count_source = 'ocr' so the UI labels them —
        // and a manual entry still wins over them.
        if (! $result['countable'] && OcrCounter::supports($extension) && $ocr->available()) {
            $estimate = $ocr->count($path, $extension);

            if ($estimate['countable']) {
                $estimate['pages'] ??= $result['pages'];
                $result = $estimate;
                $source = 'ocr';
            } else {
                $result['pages'] ??= $estimate['pages'];
            }
        }

        $file->update([
            'word_count' => $result['words'],
            'page_count' => $result['pages'],
            'char_count' => $result['chars'],
            'count_status' => $result['countable']
                ? ProjectFile::COUNT_DONE
                : ProjectFile::COUNT_NOT_APPLICABLE,
            'count_source' => $source,
        ]);

        $file->project->refreshTotals();
    }

    public function failed(): void
    {
        $this->file->fresh()?->update(['count_status' => ProjectFile::COUNT_FAILED]);
    }
}
