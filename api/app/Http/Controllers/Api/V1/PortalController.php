<?php

namespace App\Http\Controllers\Api\V1;

use App\Events\ProjectClaimed;
use App\Events\ProjectDelivered;
use App\Http\Controllers\Controller;
use App\Http\Resources\AssignmentResource;
use App\Http\Resources\PortalProjectResource;
use App\Http\Resources\PortalTemplateResource;
use App\Http\Resources\ProjectFileResource;
use App\Models\Assignment;
use App\Models\LetterheadTemplate;
use App\Models\Project;
use App\Notifications\ProjectDeliveredNotification;
use App\Services\DocumentMergeService;
use App\Services\PortalService;
use App\Support\PlacementConfig;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Symfony\Component\HttpFoundation\StreamedResponse;

class PortalController extends Controller
{
    /** A visa application's worth of documents, with room to spare. */
    private const MAX_DELIVERY_FILES = 20;

    public function __construct(
        private readonly PortalService $portal,
    ) {}

    public function queue(Request $request): AnonymousResourceCollection
    {
        $filters = $request->validate([
            'search' => ['nullable', 'string', 'max:120'],
            'priority' => ['nullable', 'in:normal,urgent,critical'],
            'service_type' => ['nullable', 'string', 'max:60'],
            'source_language_id' => ['nullable', 'integer', 'exists:languages,id'],
            'target_language_id' => ['nullable', 'integer', 'exists:languages,id'],
            'my_pairs' => ['nullable', 'boolean'],
        ]);

        return PortalProjectResource::collection(
            $this->portal->queueFor($request->user(), $filters)
                ->paginate(min($request->integer('per_page', 20), 50)),
        );
    }

    public function claim(Request $request, Project $project): AssignmentResource
    {
        $assignment = $this->portal->claim($project, $request->user());

        // Post-commit: yank the card off every other matching translator's screen.
        $this->broadcastLive(new ProjectClaimed($project->refresh()));

        return AssignmentResource::make(
            $assignment->load(['project.sourceLanguage', 'project.targetLanguage', 'project.files']),
        );
    }

    public function current(Request $request): JsonResponse
    {
        $assignment = $this->portal->currentAssignment($request->user());

        if ($assignment === null) {
            return response()->json(['data' => null]);
        }

        $revision = $this->portal->revisionNote($assignment->project);

        return response()->json([
            'data' => AssignmentResource::make($assignment)->resolve($request),
            'revision_note' => $revision ? [
                'note' => $revision->note,
                'by' => $revision->actor?->name,
                'at' => $revision->created_at->toIso8601String(),
                // Only this round's attachments — the loop can run several times and
                // last round's screenshots would be actively misleading here.
                'attachments' => ProjectFileResource::collection($revision->attachments)->resolve($request),
            ] : null,
        ]);
    }

    /**
     * Deliver one or more files as a single round.
     *
     * `files[]` is the shape; a lone `file` still works so nothing posting the old
     * way breaks. Every file of the round is letterheaded into its own final —
     * see MergeFinalFileJob.
     */
    public function deliver(Request $request): AssignmentResource
    {
        // Not mutated into the request: Request::allFiles() memoises on its first
        // read, so a later write to the file bag is silently ignored and the upload
        // validates but arrives as null.
        $uploads = $request->hasFile('files')
            ? Arr::wrap($request->file('files'))
            : Arr::wrap($request->file('file'));

        $validated = Validator::make(['files' => array_values(array_filter($uploads))], [
            'files' => ['required', 'array', 'min:1', 'max:'.self::MAX_DELIVERY_FILES],
            'files.*' => ['file', 'max:51200'],
        ])->validate();

        $assignment = $this->portal->deliver(
            $request->user(),
            $validated['files'],
            $this->stampPlacements($request, count($validated['files'])),
        );

        $assignment->project->creator->notify(new ProjectDeliveredNotification($assignment->project, $request->user()));
        $this->broadcastLive(new ProjectDelivered($assignment->project, $request->user()));

        return AssignmentResource::make($assignment->load('project'));
    }

    public function history(Request $request): AnonymousResourceCollection
    {
        $assignments = Assignment::query()
            ->where('translator_id', $request->user()->id)
            ->whereIn('status', [Assignment::STATUS_DELIVERED, Assignment::STATUS_WITHDRAWN])
            ->with(['project.sourceLanguage', 'project.targetLanguage'])
            ->latest('claimed_at')
            ->paginate(min($request->integer('per_page', 15), 100));

        return AssignmentResource::collection($assignments);
    }

    /** Translators may download files ONLY for the project they currently hold. */
    public function downloadFile(Request $request, int $fileId): StreamedResponse
    {
        $assignment = $this->portal->currentAssignment($request->user());
        abort_if($assignment === null, 404);

        $file = $assignment->project->files()->whereKey($fileId)->firstOrFail();

        return Storage::disk('local')->download($file->disk_path, $file->original_name);
    }

    /** Active templates only — the picker for the translator's draft preview. */
    public function templates(): AnonymousResourceCollection
    {
        return PortalTemplateResource::collection(
            LetterheadTemplate::query()->active()->orderBy('kind')->orderBy('name')->get(),
        );
    }

    /**
     * The template's own image, for the picker thumbnail.
     *
     * Gated on is_active as well as existence: a retired stamp should not be
     * readable through the portal just because its id is still guessable.
     */
    public function templateAsset(LetterheadTemplate $letterhead): StreamedResponse
    {
        abort_unless($letterhead->is_active, 404);
        abort_unless(Storage::disk('local')->exists($letterhead->disk_path), 404);

        return Storage::disk('local')->response(
            $letterhead->disk_path,
            basename($letterhead->disk_path),
            ['Cache-Control' => 'private, max-age=300'],
        );
    }

    /**
     * Draft preview: the translator's own file, merged with a letterhead and stamp
     * so they can see the text clears the header and the seal misses the last lines.
     *
     * This is NOT a certified document and must never become one:
     *   - every page carries a diagonal "مسودة — غير معتمدة" watermark,
     *   - nothing is written to project_files, so it cannot be mistaken for a
     *     delivery or picked up by the merge job,
     *   - the project's own letterhead_id/stamp_id are untouched; approval still
     *     decides what the real final file carries.
     *
     * Requires holding the project, so it costs a Gotenberg conversion only for
     * someone actually working on a file.
     */
    public function previewMerge(Request $request, DocumentMergeService $merger): Response
    {
        $assignment = $this->portal->currentAssignment($request->user());
        abort_if($assignment === null, 404, __('portal.no_active_assignment'));

        $validated = $request->validate([
            'file' => ['required', 'file', 'max:51200'],
            'letterhead_id' => ['nullable', 'integer', 'exists:letterhead_templates,id'],
            'stamp_id' => ['nullable', 'integer', 'exists:letterhead_templates,id'],
        ]);

        // So the draft shows the seal where the translator just dragged it, not where
        // the template would have put it. Index 0: the preview takes one file.
        $placement = $this->stampPlacements($request, 1)[0] ?? null;

        $letterhead = $this->activeTemplate($validated['letterhead_id'] ?? null, LetterheadTemplate::KIND_LETTERHEAD);
        $stamp = $this->activeTemplate($validated['stamp_id'] ?? null, LetterheadTemplate::KIND_STAMP);

        abort_if(
            $letterhead === null && $stamp === null,
            422,
            __('portal.preview_requires_template'),
        );

        // Stored under the holder's own id, not the project's, so a preview can
        // never be confused with the project's real files.
        $path = $request->file('file')->store("previews/{$request->user()->id}", 'local');

        try {
            $pdf = $merger->mergeStoredFile(
                $path,
                $request->file('file')->getClientOriginalName(),
                $letterhead,
                $stamp,
                __('portal.draft_watermark'),
                $placement,
            );
        } finally {
            Storage::disk('local')->delete($path);
        }

        return response($pdf, 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'attachment; filename="draft-'.$assignment->project->code.'.pdf"',
            'Cache-Control' => 'private, no-store',
        ]);
    }

    /**
     * The page the stamp will be dragged onto, as an image, plus its real size in mm.
     *
     * The translator uploads the file they are about to deliver, and gets back the page
     * the merge would actually produce — converted, letterheaded, repaginated — with no
     * stamp on it. The browser overlays the seal as a draggable element and hands the
     * resulting millimetre position back with the delivery.
     *
     * It has to be this page and not the uploaded Word file: LibreOffice repaginates,
     * and the content band widens the margins first, so a position measured against the
     * .docx would be a position on a page that never exists.
     *
     * Costs a Gotenberg conversion and a ghostscript render, so it sits behind the same
     * throttle as the draft preview and requires holding the project.
     */
    public function stampSurface(Request $request, DocumentMergeService $merger): JsonResponse
    {
        $assignment = $this->portal->currentAssignment($request->user());
        abort_if($assignment === null, 404, __('portal.no_active_assignment'));

        $validated = $request->validate([
            'file' => ['required', 'file', 'max:51200'],
            'letterhead_id' => ['nullable', 'integer', 'exists:letterhead_templates,id'],
            'page' => ['nullable', 'integer', 'min:1', 'max:500'],
        ]);

        $letterhead = $this->activeTemplate($validated['letterhead_id'] ?? null, LetterheadTemplate::KIND_LETTERHEAD);

        // Under the holder's own id, never the project's — a surface render is not a
        // delivery and must not be mistaken for one.
        $path = $request->file('file')->store("previews/{$request->user()->id}", 'local');

        try {
            $surface = $merger->stampSurface(
                $path,
                $request->file('file')->getClientOriginalName(),
                $letterhead,
                $validated['page'] ?? null,
            );
        } finally {
            Storage::disk('local')->delete($path);
        }

        return response()->json([
            'data' => [
                // Inlined rather than served from a URL: the surface belongs to one
                // drag on one unsaved upload, so there is nothing to cache and nothing
                // that should outlive the request.
                'image' => 'data:image/jpeg;base64,'.base64_encode($surface['image']),
                'width_mm' => $surface['width_mm'],
                'height_mm' => $surface['height_mm'],
                'page' => $surface['page'],
                'pages' => $surface['pages'],
            ],
        ]);
    }

    /**
     * Normalized stamp placements from a multipart delivery, keyed by file index.
     *
     * Multipart can only carry strings, so each entry arrives JSON-encoded — the same
     * accommodation StoreLetterheadTemplateRequest makes. Anything unparseable is
     * dropped rather than rejected: a delivery must never fail because the optional
     * position that rides along with it was malformed.
     *
     * @return array<int, array>
     */
    private function stampPlacements(Request $request, int $fileCount): array
    {
        $raw = $request->input('stamp_placements');

        if (is_string($raw)) {
            $raw = json_decode($raw, true);
        }

        if (! is_array($raw)) {
            return [];
        }

        $placements = [];

        foreach ($raw as $index => $placement) {
            if (is_string($placement)) {
                $placement = json_decode($placement, true);
            }

            if (! is_array($placement) || ! is_numeric($index) || $index < 0 || $index >= $fileCount) {
                continue;
            }

            // sanitize(), not normalize(): no stamp template has been chosen yet, so
            // the gaps must stay gaps for the merge to fill from whichever seal the PM
            // picks at approval. See PlacementConfig::sanitize().
            $clean = PlacementConfig::sanitize($placement);

            if ($clean !== []) {
                $placements[(int) $index] = $clean;
            }
        }

        return $placements;
    }

    /** An active template of the expected kind, or null. */
    private function activeTemplate(?int $id, string $kind): ?LetterheadTemplate
    {
        if ($id === null) {
            return null;
        }

        return LetterheadTemplate::query()
            ->active()
            ->where('kind', $kind)
            ->whereKey($id)
            ->first();
    }
}
