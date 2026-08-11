<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreLetterheadTemplateRequest;
use App\Http\Resources\LetterheadTemplateResource;
use App\Models\LetterheadTemplate;
use App\Services\DocumentMergeService;
use App\Support\AssetOptimizer;
use App\Support\ImageTrimmer;
use App\Support\PlacementConfig;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * M9 — letterhead & stamp templates (admin).
 *
 * Assets live on the private disk; previews are streamed through `asset()` so a
 * suspended or unauthorised user can never pull a company letterhead by URL.
 */
class LetterheadController extends Controller
{
    /**
     * Byte counts from the most recent upload in this request, surfaced on the
     * response so the admin sees what the artwork now costs every delivery.
     *
     * @var array{before:int, after:int, applied:bool}|null
     */
    private ?array $lastOptimization = null;

    /** Small catalogue — returned unpaginated so gallery and pickers share one query. */
    public function index(Request $request): AnonymousResourceCollection
    {
        $request->validate([
            'kind' => ['nullable', Rule::in(LetterheadTemplate::KINDS)],
            'active' => ['nullable', 'boolean'],
        ]);

        $templates = LetterheadTemplate::query()
            ->withCount(['letterheadProjects', 'stampProjects'])
            ->with('creator:id,name')
            ->when($request->filled('kind'), fn ($query) => $query->where('kind', $request->string('kind')->toString()))
            ->when($request->filled('active'), fn ($query) => $query->where('is_active', $request->boolean('active')))
            ->orderBy('kind')
            ->orderByDesc('created_at')
            ->get();

        return LetterheadTemplateResource::collection($templates);
    }

    public function store(StoreLetterheadTemplateRequest $request): JsonResponse
    {
        $validated = $request->validated();
        $kind = $validated['kind'];

        $template = LetterheadTemplate::create([
            'name' => $validated['name'],
            'kind' => $kind,
            'disk_path' => $this->storeAsset($request->file('asset'), $kind),
            'placement' => PlacementConfig::normalize($validated['placement'] ?? null, $kind),
            'is_active' => $validated['is_active'] ?? true,
            'created_by' => $request->user()->id,
        ]);

        return LetterheadTemplateResource::make($this->withUsage($template))
            ->additional($this->optimizationPayload())
            ->response()
            ->setStatusCode(201);
    }

    /** Metadata + optional asset replacement (multipart POST with `_method=PUT`). */
    public function update(StoreLetterheadTemplateRequest $request, LetterheadTemplate $letterhead): LetterheadTemplateResource
    {
        $validated = $request->validated();

        $attributes = [
            'name' => $validated['name'] ?? $letterhead->name,
            'is_active' => $validated['is_active'] ?? $letterhead->is_active,
        ];

        if ($request->has('placement')) {
            $attributes['placement'] = PlacementConfig::normalize($validated['placement'] ?? null, $letterhead->kind);
        }

        if ($request->hasFile('asset')) {
            $previousPath = $letterhead->disk_path;
            $attributes['disk_path'] = $this->storeAsset($request->file('asset'), $letterhead->kind);
            Storage::disk('local')->delete($previousPath);
        }

        $letterhead->update($attributes);

        return LetterheadTemplateResource::make($this->withUsage($letterhead->fresh()))
            ->additional($this->optimizationPayload());
    }

    public function destroy(LetterheadTemplate $letterhead): JsonResponse
    {
        abort_if($letterhead->isUsedByProjects(), 422, __('letterheads.in_use'));

        Storage::disk('local')->delete($letterhead->disk_path);
        $letterhead->delete();

        return response()->json(['message' => 'ok']);
    }

    /** Inline stream for gallery previews and approval-dialog thumbnails. */
    public function asset(LetterheadTemplate $letterhead): StreamedResponse
    {
        abort_unless(Storage::disk('local')->exists($letterhead->disk_path), 404);

        return Storage::disk('local')->response(
            $letterhead->disk_path,
            basename($letterhead->disk_path),
            ['Cache-Control' => 'private, max-age=300'],
        );
    }

    /**
     * M9b — render this template over a specimen page so the admin can judge the
     * placement before any real project uses it.
     *
     * The specimen is Arabic on purpose: it is the fastest way to catch a stamp that
     * lands on the text or a content band that crops the last line.
     */
    public function preview(LetterheadTemplate $letterhead, DocumentMergeService $merger): Response
    {
        abort_unless(Storage::disk('local')->exists($letterhead->disk_path), 404);

        $letterheadTemplate = $letterhead->kind === LetterheadTemplate::KIND_LETTERHEAD ? $letterhead : null;
        $stampTemplate = $letterhead->kind === LetterheadTemplate::KIND_STAMP ? $letterhead : null;

        $specimen = $merger->specimenPdf();

        try {
            $pdf = $merger->merge($specimen, $letterheadTemplate, $stampTemplate);
        } finally {
            @unlink($specimen);
        }

        return response($pdf, 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'inline; filename="preview.pdf"',
            'Cache-Control' => 'private, no-store',
        ]);
    }

    /**
     * Store the uploaded artwork, then trim and shrink it.
     *
     * A stamp is almost always scanned on a full sheet, so it is trimmed to its ink
     * first — otherwise `width_mm` sizes the sheet rather than the stamp (see
     * App\Support\ImageTrimmer) and the optimiser spends its budget on empty paper.
     * The optimiser then downsamples what is left: this artwork is redrawn into every
     * page of every delivery, so its weight is paid on every client download
     * (App\Support\AssetOptimizer).
     *
     * Both steps are best-effort. Neither can fail the upload.
     */
    private function storeAsset(UploadedFile $asset, string $kind): string
    {
        $path = $asset->store('letterheads', 'local');
        $absolute = Storage::disk('local')->path($path);

        if ($kind === LetterheadTemplate::KIND_STAMP) {
            ImageTrimmer::trim($absolute);
        }

        $this->lastOptimization = AssetOptimizer::optimize($absolute);

        return $path;
    }

    /**
     * `meta.optimization` on an upload response, absent when nothing was uploaded.
     *
     * The admin who picked the file is the one person who can act on it — if the
     * artwork barely shrank, it is still a scan and still costs every client every
     * download, and they can go get a cleaner export.
     *
     * @return array{meta?: array{optimization: array{before:int, after:int, applied:bool}}}
     */
    private function optimizationPayload(): array
    {
        return $this->lastOptimization === null
            ? []
            : ['meta' => ['optimization' => $this->lastOptimization]];
    }

    private function withUsage(LetterheadTemplate $template): LetterheadTemplate
    {
        return $template->loadCount(['letterheadProjects', 'stampProjects'])->load('creator:id,name');
    }
}
