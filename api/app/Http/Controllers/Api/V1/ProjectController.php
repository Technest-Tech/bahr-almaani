<?php

namespace App\Http\Controllers\Api\V1;

use App\Events\ProjectCancelled;
use App\Events\ProjectPublished;
use App\Events\ProjectWithdrawn;
use App\Exceptions\InvalidTransitionException;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreProjectRequest;
use App\Http\Resources\ProjectResource;
use App\Http\Resources\TransitionResource;
use App\Models\Assignment;
use App\Models\Project;
use App\Models\ProjectFile;
use App\Notifications\ProjectAvailableNotification;
use App\Notifications\ProjectWithdrawnNotification;
use App\Services\ProjectCodeGenerator;
use App\Services\ProjectTransitionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;

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
                // Scout (Meilisearch): typo-tolerant search over code/title/client/instructions.
                $query->whereIn('projects.id', Project::search(
                    $request->string('q')->trim()->toString(),
                )->take(500)->keys());
            })
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')->toString()))
            ->when($request->filled('priority'), fn ($q) => $q->where('priority', $request->string('priority')->toString()))
            ->when($request->filled('client_id'), fn ($q) => $q->where('client_id', $request->integer('client_id')))
            ->when($request->boolean('late'), fn ($q) => $q->late())
            ->tap(function ($query) use ($request): void {
                // Server-side sorting: the whole result set, not just the current page.
                $sortable = ['created_at', 'deadline_at', 'title', 'code', 'status', 'priority', 'total_words'];
                $sort = $request->string('sort')->toString();
                $query->orderBy(
                    in_array($sort, $sortable, true) ? $sort : 'created_at',
                    $request->string('dir')->toString() === 'asc' ? 'asc' : 'desc',
                );
            })
            ->paginate(min($request->integer('per_page', 15), 100));

        return ProjectResource::collection($projects);
    }

    public function show(Project $project): ProjectResource
    {
        return ProjectResource::make($project->load([
            'client', 'sourceLanguage', 'targetLanguage', 'creator:id,name',
            'assignments.translator:id,name', 'letterhead', 'stamp',
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

        $this->broadcastLive(new ProjectPublished($project));
        Notification::send(
            $project->portalTranslators(),
            new ProjectAvailableNotification($project->load('sourceLanguage', 'targetLanguage')),
        );

        return ProjectResource::make($project->load(['client', 'sourceLanguage', 'targetLanguage']));
    }

    /** claimed → available: release a sick/absent translator's file (reason required). */
    public function withdraw(Request $request, Project $project): ProjectResource
    {
        $validated = $request->validate(['reason' => ['required', 'string', 'max:1000']]);

        $translator = null;

        $project = DB::transaction(function () use ($request, $project, $validated, &$translator): Project {
            $assignment = $project->activeAssignment();

            $fresh = $this->transitions->transition(
                $project,
                Project::STATUS_AVAILABLE,
                $request->user(),
                $validated['reason'],
            );

            if ($assignment) {
                $assignment->update([
                    'status' => Assignment::STATUS_WITHDRAWN,
                    'withdrawn_at' => now(),
                    'withdrawn_by' => $request->user()->id,
                    'withdraw_reason' => $validated['reason'],
                ]);
                $translator = $assignment->translator;
            }

            return $fresh;
        });

        $this->broadcastLive(new ProjectWithdrawn($project));
        $translator?->notify(new ProjectWithdrawnNotification($project, $validated['reason']));
        Notification::send(
            $project->portalTranslators()->reject(fn ($t) => $t->is($translator)),
            new ProjectAvailableNotification($project->load('sourceLanguage', 'targetLanguage')),
        );

        return ProjectResource::make($project->load(['client', 'sourceLanguage', 'targetLanguage']));
    }

    /** completed → archived: file the project away once the client has taken delivery. */
    public function archive(Request $request, Project $project): ProjectResource
    {
        $project = $this->transitions->transition($project, Project::STATUS_ARCHIVED, $request->user());

        return ProjectResource::make($project->load(['client', 'sourceLanguage', 'targetLanguage']));
    }

    /** Any cancellable state → cancelled. Reason is mandatory. */
    public function cancel(Request $request, Project $project): ProjectResource
    {
        $validated = $request->validate(['reason' => ['required', 'string', 'max:1000']]);

        $wasOnPortal = in_array($project->status, [Project::STATUS_AVAILABLE, Project::STATUS_CLAIMED], true);

        $project = $this->transitions->transition(
            $project,
            Project::STATUS_CANCELLED,
            $request->user(),
            $validated['reason'],
        );

        if ($wasOnPortal) {
            $this->broadcastLive(new ProjectCancelled($project));
        }

        return ProjectResource::make($project->load(['client', 'sourceLanguage', 'targetLanguage']));
    }

    public function timeline(Project $project): AnonymousResourceCollection
    {
        return TransitionResource::collection(
            $project->transitions()->with(['actor:id,name', 'attachments'])->get()
        );
    }
}
