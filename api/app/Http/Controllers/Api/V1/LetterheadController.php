<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreLetterheadTemplateRequest;
use App\Http\Resources\LetterheadTemplateResource;
use App\Models\LetterheadTemplate;
use App\Support\PlacementConfig;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
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
            'disk_path' => $request->file('asset')->store('letterheads', 'local'),
            'placement' => PlacementConfig::normalize($validated['placement'] ?? null, $kind),
            'is_active' => $validated['is_active'] ?? true,
            'created_by' => $request->user()->id,
        ]);

        return LetterheadTemplateResource::make($this->withUsage($template))
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
            $attributes['disk_path'] = $request->file('asset')->store('letterheads', 'local');
            Storage::disk('local')->delete($previousPath);
        }

        $letterhead->update($attributes);

        return LetterheadTemplateResource::make($this->withUsage($letterhead->fresh()));
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

    private function withUsage(LetterheadTemplate $template): LetterheadTemplate
    {
        return $template->loadCount(['letterheadProjects', 'stampProjects'])->load('creator:id,name');
    }
}
