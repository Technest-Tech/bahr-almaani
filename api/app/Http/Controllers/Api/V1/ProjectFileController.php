<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\ProjectFileResource;
use App\Jobs\CountWordsJob;
use App\Models\Project;
use App\Models\ProjectFile;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Arr;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;
use ZipArchive;

class ProjectFileController extends Controller
{
    private const MAX_FILE_KB = 51200; // 50 MB

    /** A page-by-page photographed document, with room to spare. */
    private const MAX_FILES = 20;

    /**
     * Attach one or more files to the project.
     *
     * The office photographs a multi-page document page by page, so a single "source"
     * is routinely a handful of images; making them upload one at a time was the
     * complaint that produced this. `files[]` is the shape; a lone `file` is still
     * accepted so nothing that already posts the old way breaks.
     */
    public function store(Request $request, Project $project): JsonResponse
    {
        $validated = Validator::make([
            'files' => $this->uploadedFiles($request),
            'category' => $request->input('category'),
        ], [
            'files' => ['required', 'array', 'min:1', 'max:'.self::MAX_FILES],
            'files.*' => ['file', 'max:'.self::MAX_FILE_KB],
            'category' => ['required', Rule::in([ProjectFile::CATEGORY_SOURCE, ProjectFile::CATEGORY_REFERENCE])],
        ])->validate();

        $category = $validated['category'];
        $uploads = $validated['files'];

        // Work files only while drafting; reference docs any time before completion.
        if ($category === ProjectFile::CATEGORY_SOURCE) {
            abort_unless($project->status === Project::STATUS_DRAFT, 422, __('projects.source_upload_draft_only'));
        } else {
            abort_if(in_array($project->status, Project::SETTLED_STATUSES, true), 422, __('projects.source_upload_draft_only'));
        }

        // Read before the batch lands: "the first source file names the project"
        // means the first one ever, not the first of this upload — otherwise adding
        // page two later would rename the project.
        $hadSources = $project->files()->where('category', ProjectFile::CATEGORY_SOURCE)->exists();

        // One transaction: a batch that fails halfway must not leave the project with
        // three of five pages attached and no sign that the rest went missing.
        $files = DB::transaction(function () use ($request, $project, $category, $uploads): Collection {
            return collect($uploads)->map(function (UploadedFile $upload) use ($request, $project, $category): ProjectFile {
                $file = $project->files()->create([
                    'category' => $category,
                    'uploaded_by' => $request->user()->id,
                    'original_name' => $upload->getClientOriginalName(),
                    'disk_path' => $upload->store("projects/{$project->id}/{$category}", 'local'),
                    'mime_type' => $upload->getClientMimeType(),
                    'size_bytes' => $upload->getSize(),
                ]);

                if ($category !== ProjectFile::CATEGORY_SOURCE) {
                    $file->update(['count_status' => ProjectFile::COUNT_NOT_APPLICABLE]);
                }

                return $file;
            });
        });

        // Queued after commit so the counter reads rows that exist.
        $files->each(function (ProjectFile $file) use ($category): void {
            if ($category === ProjectFile::CATEGORY_SOURCE) {
                CountWordsJob::dispatch($file)->afterCommit();
            }
        });

        $this->nameProjectAfterFirstSource($project, $category, $files, $hadSources);

        return ProjectFileResource::collection($files)->response()->setStatusCode(201);
    }

    /**
     * Let the first source file name an unnamed project.
     *
     * The office asked to skip the name field: the project is created before any
     * file exists, so it starts life carrying its own code (ProjectController::store)
     * and the first source upload replaces that. `title_auto` is what marks it as
     * still the system's to set — a PM who types a name owns it, and no later upload
     * overwrites their wording.
     *
     * Reference documents never name a project: a passport photocopy attached for
     * context is not what the job is called.
     *
     * @param  Collection<int, ProjectFile>  $files
     */
    private function nameProjectAfterFirstSource(
        Project $project,
        string $category,
        Collection $files,
        bool $hadSources,
    ): void {
        if ($category !== ProjectFile::CATEGORY_SOURCE || $hadSources || ! $project->title_auto) {
            return;
        }

        $base = trim(pathinfo((string) $files->first()?->original_name, PATHINFO_FILENAME));

        if ($base === '') {
            return;
        }

        // Truncated, not rejected: the column is 255 and a phone-generated filename
        // can be longer than that.
        $project->forceFill(['title' => Str::limit($base, 255, '')])->save();
    }

    /**
     * The uploads, whether posted as `files[]` or as a single legacy `file`.
     *
     * Deliberately does not mutate the request. Request::allFiles() memoises on its
     * first read, so writing into the file bag after any hasFile()/file() call is
     * silently ignored — the upload then validates and arrives as null.
     *
     * @return list<UploadedFile>
     */
    private function uploadedFiles(Request $request): array
    {
        $uploads = $request->hasFile('files')
            ? Arr::wrap($request->file('files'))
            : Arr::wrap($request->file('file'));

        return array_values(array_filter($uploads));
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

    /** Manual word/page entry — overrides the automatic count and any OCR estimate. */
    public function manualCount(Request $request, Project $project, ProjectFile $file): ProjectFileResource
    {
        abort_unless($file->project_id === $project->id, 404);

        $validated = $request->validate([
            'word_count' => ['nullable', 'integer', 'min:0', 'max:10000000', 'required_without_all:page_count,char_count'],
            'page_count' => ['nullable', 'integer', 'min:0', 'max:100000', 'required_without_all:word_count,char_count'],
            'char_count' => ['nullable', 'integer', 'min:0', 'max:100000000', 'required_without_all:word_count,page_count'],
        ]);

        abort_unless(
            in_array($file->count_status, [ProjectFile::COUNT_NOT_APPLICABLE, ProjectFile::COUNT_FAILED, ProjectFile::COUNT_DONE], true),
            422,
            __('projects.manual_count_not_applicable'),
        );

        $file->update([
            'word_count' => $validated['word_count'] ?? $file->word_count,
            'page_count' => $validated['page_count'] ?? $file->page_count,
            'char_count' => $validated['char_count'] ?? $file->char_count,
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
     * without first reading the project's file list. A project may now hold several
     * finals (one per delivered document); this returns the first, and finalArchive()
     * hands back the whole set.
     */
    public function finalFile(Project $project): StreamedResponse
    {
        $final = $project->files()
            ->where('category', ProjectFile::CATEGORY_FINAL)
            ->orderBy('id')
            ->first();

        abort_if($final === null, 404, __('projects.final_file_missing'));
        abort_unless(Storage::disk('local')->exists($final->disk_path), 404, __('projects.final_file_missing'));

        return Storage::disk('local')->download($final->disk_path, $final->original_name);
    }

    /**
     * Every final file of the project, as one zip.
     *
     * A visa application comes back as three certified PDFs; asking the client to
     * click three times — each a separate slow transfer — is what "download all"
     * exists to avoid. Built on disk rather than in memory: these are letterheaded
     * scans and a handful of them will not fit in a request's memory budget.
     */
    public function finalArchive(Project $project): BinaryFileResponse
    {
        $finals = $project->files()
            ->where('category', ProjectFile::CATEGORY_FINAL)
            ->orderBy('id')
            ->get()
            ->filter(fn (ProjectFile $file) => Storage::disk('local')->exists($file->disk_path))
            ->values();

        abort_if($finals->isEmpty(), 404, __('projects.final_file_missing'));

        $archive = tempnam(sys_get_temp_dir(), 'finals-').'.zip';
        $zip = new ZipArchive;

        abort_unless($zip->open($archive, ZipArchive::OVERWRITE | ZipArchive::CREATE) === true, 500);

        $used = [];

        foreach ($finals as $file) {
            // Two source documents can share a filename; a zip entry cannot.
            $name = $file->original_name;
            $used[$name] = ($used[$name] ?? 0) + 1;

            if ($used[$name] > 1) {
                $name = pathinfo($name, PATHINFO_FILENAME).' ('.$used[$name].').'.pathinfo($name, PATHINFO_EXTENSION);
            }

            $zip->addFile(Storage::disk('local')->path($file->disk_path), $name);
        }

        $zip->close();

        return response()
            ->download($archive, "{$project->code}.zip", ['Content-Type' => 'application/zip'])
            ->deleteFileAfterSend();
    }
}
