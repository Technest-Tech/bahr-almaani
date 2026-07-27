<?php

namespace App\Http\Controllers\Api\V1;

use App\Exceptions\InvalidTransitionException;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreProjectRequest;
use App\Http\Resources\ProjectResource;
use App\Http\Resources\TransitionResource;
use App\Models\Project;
use App\Models\ProjectFile;
use App\Services\ProjectCodeGenerator;
use App\Services\ProjectTransitionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class ProjectController extends Controller
{
    public function __construct(
        private readonly ProjectTransitionService $transitions,
    ) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        $projects = Project::query()
            ->with(['client:id,name,type', 'sourceLanguage', 'targetLanguage', 'creator:id,name'])
            ->withCount('files')
            ->when($request->filled('q'), function ($query) use ($request): void {
                $q = '%'.$request->string('q')->trim().'%';
                $query->where(fn ($w) => $w->where('title', 'ilike', $q)->orWhere('code', 'ilike', $q));
            })
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')->toString()))
            ->when($request->filled('priority'), fn ($q) => $q->where('priority', $request->string('priority')->toString()))
            ->when($request->filled('client_id'), fn ($q) => $q->where('client_id', $request->integer('client_id')))
            ->when($request->boolean('late'), fn ($q) => $q->late())
            ->orderByDesc('created_at')
            ->paginate(min($request->integer('per_page', 15), 100));

        return ProjectResource::collection($projects);
    }

    public function show(Project $project): ProjectResource
    {
        return ProjectResource::make($project->load([
            'client', 'sourceLanguage', 'targetLanguage', 'creator:id,name',
            'files' => fn ($q) => $q->with('uploader:id,name')->orderBy('category')->orderByDesc('created_at'),
        ]));
    }

    public function store(StoreProjectRequest $request, ProjectCodeGenerator $codes): JsonResponse
    {
        $project = Project::create([
            ...$request->validated(),
            'code' => $codes->next(),
            'status' => Project::STATUS_DRAFT,
            'created_by' => $request->user()->id,
        ]);

        return ProjectResource::make($project->load(['client', 'sourceLanguage', 'targetLanguage']))
            ->response()
            ->setStatusCode(201);
    }

    public function update(StoreProjectRequest $request, Project $project): ProjectResource
    {
        abort_unless(
            $project->status === Project::STATUS_DRAFT,
            422,
            __('projects.edit_draft_only'),
        );

        $project->update($request->validated());

        return ProjectResource::make($project->load(['client', 'sourceLanguage', 'targetLanguage']));
    }

    /** draft → available. Requires at least one source file. */
    public function publish(Request $request, Project $project): ProjectResource
    {
        if (! $project->files()->where('category', ProjectFile::CATEGORY_SOURCE)->exists()) {
            throw new InvalidTransitionException(__('projects.publish_requires_source'));
        }

        $project = $this->transitions->transition($project, Project::STATUS_AVAILABLE, $request->user());

        return ProjectResource::make($project->load(['client', 'sourceLanguage', 'targetLanguage']));
    }

    /** Any cancellable state → cancelled. Reason is mandatory. */
    public function cancel(Request $request, Project $project): ProjectResource
    {
        $validated = $request->validate(['reason' => ['required', 'string', 'max:1000']]);

        $project = $this->transitions->transition(
            $project,
            Project::STATUS_CANCELLED,
            $request->user(),
            $validated['reason'],
        );

        return ProjectResource::make($project->load(['client', 'sourceLanguage', 'targetLanguage']));
    }

    public function timeline(Project $project): AnonymousResourceCollection
    {
        return TransitionResource::collection(
            $project->transitions()->with('actor:id,name')->get()
        );
    }
}
