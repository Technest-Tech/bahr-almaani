<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\ProjectFileResource;
use App\Jobs\CountWordsJob;
use App\Models\Project;
use App\Models\ProjectFile;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ProjectFileController extends Controller
{
    private const MAX_FILE_KB = 51200; // 50 MB

    public function store(Request $request, Project $project): JsonResponse
    {
        $validated = $request->validate([
            'file' => ['required', 'file', 'max:'.self::MAX_FILE_KB],
            'category' => ['required', Rule::in([ProjectFile::CATEGORY_SOURCE, ProjectFile::CATEGORY_REFERENCE])],
        ]);

        // Work files only while drafting; reference docs any time before completion.
        if ($validated['category'] === ProjectFile::CATEGORY_SOURCE) {
            abort_unless($project->status === Project::STATUS_DRAFT, 422, __('projects.source_upload_draft_only'));
        } else {
            abort_if(in_array($project->status, Project::SETTLED_STATUSES, true), 422, __('projects.source_upload_draft_only'));
        }

        $upload = $validated['file'];
        $path = $upload->store("projects/{$project->id}/{$validated['category']}", 'local');

        $file = $project->files()->create([
            'category' => $validated['category'],
            'uploaded_by' => $request->user()->id,
            'original_name' => $upload->getClientOriginalName(),
            'disk_path' => $path,
            'mime_type' => $upload->getClientMimeType(),
            'size_bytes' => $upload->getSize(),
        ]);

        if ($validated['category'] === ProjectFile::CATEGORY_SOURCE) {
            CountWordsJob::dispatch($file);
        } else {
            $file->update(['count_status' => ProjectFile::COUNT_NOT_APPLICABLE]);
        }

        return ProjectFileResource::make($file)->response()->setStatusCode(201);
    }

    public function destroy(Project $project, ProjectFile $file): JsonResponse
    {
        abort_unless($file->project_id === $project->id, 404);
        abort_unless($project->status === Project::STATUS_DRAFT, 422, __('projects.file_delete_draft_only'));

        Storage::disk('local')->delete($file->disk_path);
        $file->delete();
        $project->refreshTotals();

        return response()->json(['message' => 'ok']);
    }

    /** Manual word/page entry for scanned documents (OCR is Phase 2). */
    public function manualCount(Request $request, Project $project, ProjectFile $file): ProjectFileResource
    {
        abort_unless($file->project_id === $project->id, 404);

        $validated = $request->validate([
            'word_count' => ['nullable', 'integer', 'min:0', 'max:10000000', 'required_without:page_count'],
            'page_count' => ['nullable', 'integer', 'min:0', 'max:100000', 'required_without:word_count'],
        ]);

        abort_unless(
            in_array($file->count_status, [ProjectFile::COUNT_NOT_APPLICABLE, ProjectFile::COUNT_FAILED, ProjectFile::COUNT_DONE], true),
            422,
            __('projects.manual_count_not_applicable'),
        );

        $file->update([
            'word_count' => $validated['word_count'] ?? $file->word_count,
            'page_count' => $validated['page_count'] ?? $file->page_count,
            'count_status' => ProjectFile::COUNT_DONE,
            'count_source' => 'manual',
        ]);

        $project->refreshTotals();

        return ProjectFileResource::make($file->fresh());
    }

    public function download(Project $project, ProjectFile $file): StreamedResponse
    {
        abort_unless($file->project_id === $project->id, 404);

        return Storage::disk('local')->download($file->disk_path, $file->original_name);
    }

    /**
     * M9b — the merged letterheaded deliverable (docs/03 M5).
     *
     * Shortcut past the file id so the client can link straight to "the final file"
     * without first reading the project's file list.
     */
    public function finalFile(Project $project): StreamedResponse
    {
        $final = $project->files()
            ->where('category', ProjectFile::CATEGORY_FINAL)
            ->latest('id')
            ->first();

        abort_if($final === null, 404, __('projects.final_file_missing'));
        abort_unless(Storage::disk('local')->exists($final->disk_path), 404, __('projects.final_file_missing'));

        return Storage::disk('local')->download($final->disk_path, $final->original_name);
    }
}
