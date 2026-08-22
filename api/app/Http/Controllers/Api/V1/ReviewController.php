<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\ProjectResource;
use App\Jobs\MergeFinalFileJob;
use App\Models\Assignment;
use App\Models\LetterheadTemplate;
use App\Models\Project;
use App\Models\ProjectFile;
use App\Notifications\RevisionRequestedNotification;
use App\Services\DocumentMergeService;
use App\Services\ProjectTransitionService;
use App\Support\PlacementConfig;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class ReviewController extends Controller
{
    /** Enough to show a page and a detail; more than that belongs in the note. */
    private const MAX_ATTACHMENTS = 5;

    private const MAX_ATTACHMENT_KB = 10240; // 10 MB each

    public function __construct(
        private readonly ProjectTransitionService $transitions,
    ) {}

    /** delivered → in_review */
    public function open(Request $request, Project $project): ProjectResource
    {
        $project = $this->transitions->transition($project, Project::STATUS_IN_REVIEW, $request->user());

        return $this->fresh($project);
    }

    /**
     * in_review → revision_requested (note mandatory; translator re-locked + notified).
     *
     * The note may carry attachments — a marked-up screenshot says more about a
     * mis-set seal or a wrong line than a paragraph describing it. They are stored as
     * ordinary project files under the `revision` category and bound to the transition
     * this call creates, so a translator on round three sees round three's images and
     * not round one's.
     *
     * Multipart, therefore: the request arrives as form-data when files are attached.
     */
    public function requestRevision(Request $request, Project $project): ProjectResource
    {
        $validated = $request->validate([
            'note' => ['required', 'string', 'max:2000'],
            'attachments' => ['nullable', 'array', 'max:'.self::MAX_ATTACHMENTS],
            'attachments.*' => [
                'file',
                'mimes:png,jpg,jpeg,webp,pdf',
                'max:'.self::MAX_ATTACHMENT_KB,
            ],
        ], [], ['attachments.*' => __('projects.revision_attachment')]);

        $project = DB::transaction(function () use ($request, $project, $validated): Project {
            $project = $this->transitions->transition(
                $project,
                Project::STATUS_REVISION_REQUESTED,
                $request->user(),
                $validated['note'],
            );

            $transition = $project->transitions()
                ->where('to_status', Project::STATUS_REVISION_REQUESTED)
                ->latest('created_at')
                ->latest('id')
                ->first();

            foreach ($request->file('attachments') ?? [] as $upload) {
                $project->files()->create([
                    'transition_id' => $transition?->id,
                    'category' => ProjectFile::CATEGORY_REVISION,
                    'uploaded_by' => $request->user()->id,
                    'original_name' => $upload->getClientOriginalName(),
                    'disk_path' => $upload->store("projects/{$project->id}/revision", 'local'),
                    'mime_type' => $upload->getClientMimeType(),
                    'size_bytes' => $upload->getSize(),
                    // Feedback images are not part of the job's volume — counting them
                    // would inflate the project's totals and the translator's payslip.
                    'count_status' => ProjectFile::COUNT_NOT_APPLICABLE,
                ]);
            }

            return $project;
        });

        $project->assignments()
            ->where('status', Assignment::STATUS_DELIVERED)
            ->latest('claimed_at')
            ->first()
            ?->translator
            ->notify(new RevisionRequestedNotification($project, $validated['note']));

        return $this->fresh($project);
    }

    /**
     * in_review → approved, then the finalize job completes it.
     *
     * The letterhead + stamp are chosen here and persisted on the project, so the
     * merge job (M9b) reads its overlay configuration straight off the record.
     */
    public function approve(Request $request, Project $project): ProjectResource
    {
        $validated = $request->validate([
            'letterhead_id' => [
                'required', 'integer',
                Rule::exists('letterhead_templates', 'id')
                    ->where('kind', LetterheadTemplate::KIND_LETTERHEAD)
                    ->where('is_active', true),
            ],
            'stamp_id' => [
                'required', 'integer',
                Rule::exists('letterhead_templates', 'id')
                    ->where('kind', LetterheadTemplate::KIND_STAMP)
                    ->where('is_active', true),
            ],
            // The PM's last word on where each seal sits, keyed by deliverable file id.
            // The translator's own placement is already on the row; anything sent here
            // replaces it, and anything omitted is left exactly as delivered.
            'stamp_placements' => ['sometimes', 'array'],
            'stamp_placements.*' => ['nullable', 'array'],
        ]);

        $placements = $this->stampPlacements($project, $validated['stamp_placements'] ?? []);

        // One transaction: an invalid transition must not leave a selection behind
        // on a project that was never approved.
        $project = DB::transaction(function () use ($project, $request, $validated, $placements): Project {
            $project->fill(Arr::except($validated, 'stamp_placements'))->save();

            // Loaded and saved rather than mass-updated: a query-builder update
            // skips the model's array cast and would hand the driver a PHP array.
            $project->files()->whereKey(array_keys($placements))->get()
                ->each(fn (ProjectFile $file) => $file
                    ->forceFill(['stamp_placement' => $placements[$file->id]])
                    ->save());

            return $this->transitions->transition($project, Project::STATUS_APPROVED, $request->user());
        });

        MergeFinalFileJob::dispatch($project);

        return $this->fresh($project);
    }

    /**
     * Re-run the merge after a failure (docs/02 edge case 3 — never silently completes).
     *
     * Only meaningful while the project is still `approved`: a completed project already
     * has its final file, and anything earlier has no approved deliverable to merge.
     */
    public function retryMerge(Request $request, Project $project): ProjectResource
    {
        abort_unless(
            $project->status === Project::STATUS_APPROVED,
            422,
            __('projects.merge_retry_not_applicable'),
        );

        $project->forceFill(['merge_error' => null])->saveQuietly();

        MergeFinalFileJob::dispatch($project);

        return $this->fresh($project->fresh());
    }

    /**
     * The page image the PM drags the seal on, for a deliverable already in storage.
     *
     * The portal's equivalent (PortalController::stampSurface) renders an upload the
     * translator has not delivered yet; this one renders a stored file, so the PM can
     * check and correct the position during review rather than discovering it on the
     * certified PDF. Same geometry either way — the converted, letterheaded page.
     *
     * The letterhead defaults to the project's current selection so the surface matches
     * what approval is about to produce; `letterhead_id` overrides it while the PM is
     * still trying templates in the dialog.
     */
    public function stampSurface(Request $request, Project $project, ProjectFile $file, DocumentMergeService $merger): JsonResponse
    {
        abort_unless($file->project_id === $project->id, 404);
        abort_unless($file->category === ProjectFile::CATEGORY_DELIVERABLE, 404);

        $validated = $request->validate([
            'letterhead_id' => ['nullable', 'integer', 'exists:letterhead_templates,id'],
            'page' => ['nullable', 'integer', 'min:1', 'max:500'],
        ]);

        $letterhead = isset($validated['letterhead_id'])
            ? LetterheadTemplate::query()
                ->active()
                ->where('kind', LetterheadTemplate::KIND_LETTERHEAD)
                ->find($validated['letterhead_id'])
            : $project->letterhead;

        $surface = $merger->stampSurface(
            $file->disk_path,
            $file->original_name,
            $letterhead,
            $validated['page'] ?? null,
        );

        return response()->json([
            'data' => [
                'image' => 'data:image/jpeg;base64,'.base64_encode($surface['image']),
                'width_mm' => $surface['width_mm'],
                'height_mm' => $surface['height_mm'],
                'page' => $surface['page'],
                'pages' => $surface['pages'],
            ],
        ]);
    }

    /**
     * The PM's stamp positions, filtered to files they are actually allowed to move.
     *
     * Only deliverables of this project's newest round qualify — those are the files the
     * merge will letterhead. An id belonging to another project, to a source file, or to
     * a superseded round is dropped rather than rejected: approval is the last step of a
     * long review and must not 422 because a stale id rode along in the payload.
     *
     * An explicit null clears the position, which is how the PM says "put it back where
     * the stamp template wants it".
     *
     * @param  array<int|string, array|null>  $input
     * @return array<int, array|null>
     */
    private function stampPlacements(Project $project, array $input): array
    {
        if ($input === []) {
            return [];
        }

        $version = $project->files()
            ->where('category', ProjectFile::CATEGORY_DELIVERABLE)
            ->max('version');

        $eligible = $project->files()
            ->where('category', ProjectFile::CATEGORY_DELIVERABLE)
            ->where('version', $version)
            ->pluck('id')
            ->all();

        $placements = [];

        foreach ($input as $fileId => $placement) {
            if (! is_numeric($fileId) || ! in_array((int) $fileId, $eligible, true)) {
                continue;
            }

            if ($placement === null) {
                $placements[(int) $fileId] = null;

                continue;
            }

            // sanitize(), not normalize(): what is stored stays partial so the merge
            // layers it over whichever stamp template was just chosen above.
            $clean = PlacementConfig::sanitize($placement);

            if ($clean !== []) {
                $placements[(int) $fileId] = $clean;
            }
        }

        return $placements;
    }

    private function fresh(Project $project): ProjectResource
    {
        return ProjectResource::make(
            $project->load(['client', 'sourceLanguage', 'targetLanguage', 'files.uploader:id,name', 'letterhead', 'stamp']),
        );
    }
}
