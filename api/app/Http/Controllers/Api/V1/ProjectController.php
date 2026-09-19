<?php

namespace App\Http\Controllers\Api\V1;

use App\Events\ProjectCancelled;
use App\Events\ProjectDeleted;
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
use App\Models\QuoteRequest;
use App\Models\User;
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
            ->visibleTo($request->user())
            ->with([
                'client:id,name,type', 'sourceLanguage', 'targetLanguage', 'creator:id,name',
                // The translator column — ProjectResource picks the one still on the job.
                'assignments.translator:id,name',
            ])
            ->withCount('files')
            // One EXISTS per page rather than a query per row — the list shows a
            // "waiting on the client" badge and never needs the rows themselves.
            ->withExists(['documentRequests as awaiting_documents' => fn ($q) => $q->pending()])
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
            // Who owns it; `none` is a client's submission no PM has taken yet.
            ->when($request->filled('created_by'), fn ($q) => $request->string('created_by')->toString() === 'none'
                ? $q->whereNull('projects.created_by')
                : $q->where('projects.created_by', $request->integer('created_by')))
            // Who translates it: the job is theirs unless it was withdrawn from them.
            ->when($request->filled('translator_id'), fn ($q) => $q->whereHas('assignments', fn ($a) => $a
                ->where('translator_id', $request->integer('translator_id'))
                ->where('status', '!=', Assignment::STATUS_WITHDRAWN)))
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

    /**
     * Who the admin's list can be narrowed by (2026-09-19): the PMs who own projects
     * and the translators who work on them. Drawn from the projects themselves, so a
     * PM who has since left still appears beside the work that is theirs.
     */
    public function filterOptions(Request $request): JsonResponse
    {
        abort_unless($request->user()->can('projects.view-all'), 403);

        $people = fn ($ids) => User::withTrashed()
            ->whereIn('id', $ids)
            ->orderBy('name')
            ->get(['id', 'name'])
            ->map(fn (User $user): array => ['id' => $user->id, 'name' => $user->name]);

        return response()->json(['data' => [
            'managers' => $people(Project::query()->whereNotNull('created_by')->select('created_by')),
            'translators' => $people(
                Assignment::query()->where('status', '!=', Assignment::STATUS_WITHDRAWN)->select('translator_id'),
            ),
        ]]);
    }

    public function show(Project $project): ProjectResource
    {
        return ProjectResource::make($project->load([
            'client', 'sourceLanguage', 'targetLanguage', 'creator:id,name',
            'assignments.translator:id,name', 'letterhead', 'stamps',
            'files' => fn ($q) => $q->with(['uploader:id,name', 'clientUploader:id,name'])
                ->orderBy('category')
                ->orderByDesc('created_at'),
            'documentRequests' => fn ($q) => $q->with('file:id,original_name'),
        ]));
    }

    public function store(StoreProjectRequest $request, ProjectCodeGenerator $codes): JsonResponse
    {
        $validated = $request->validated();
        $code = $codes->next();

        // A blank name is seeded with the code so every notification, export and
        // event still has a real string to print, and flagged so the first source
        // file can claim it — the project exists before any file does.
        $titled = filled($validated['title'] ?? null);

        $project = Project::create([
            ...$validated,
            'title' => $titled ? $validated['title'] : $code,
            'title_auto' => ! $titled,
            'code' => $code,
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

        $validated = $request->validated();

        // Typing a name takes ownership of it; blanking the field hands it back to
        // the file. Either way the column keeps a value — it is NOT NULL.
        if (array_key_exists('title', $validated)) {
            $named = filled($validated['title']);
            $validated['title'] = $named ? $validated['title'] : $project->code;
            $validated['title_auto'] = ! $named;
        }

        $project->update($validated);
        $this->claimOwnership($project, $request->user());

        return ProjectResource::make($project->load(['client', 'sourceLanguage', 'targetLanguage']));
    }

    /**
     * A client's own submission belongs to nobody until a PM works on it; the
     * first to do so owns it, and hears about its delivery and its deadlines.
     *
     * Decided on the row, not on the copy this request loaded: two PMs acting at
     * once both loaded NULL, and only the first write may land.
     */
    private function claimOwnership(Project $project, User $pm): void
    {
        if ($project->created_by !== null) {
            return;
        }

        Project::whereKey($project->getKey())->whereNull('created_by')->update(['created_by' => $pm->getKey()]);
        $project->refresh();
    }

    /** draft → available. Requires at least one source file. */
    public function publish(Request $request, Project $project): ProjectResource
    {
        if (! $project->files()->where('category', ProjectFile::CATEGORY_SOURCE)->exists()) {
            throw new InvalidTransitionException(__('projects.publish_requires_source'));
        }

        // Published straight from the client's submission, unedited: the publisher
        // takes it. Every project in the pipeline has an owner — see update(). Only
        // once the publish has gone through, and under its row lock: a PM whose
        // publish lost the race must not walk away owning the project.
        $project = DB::transaction(function () use ($request, $project): Project {
            $published = $this->transitions->transition($project, Project::STATUS_AVAILABLE, $request->user());
            $this->claimOwnership($published, $request->user());

            return $published;
        });

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

    /**
     * Delete a project nobody has worked on — a duplicate, a test, a job entered twice.
     *
     * The line is a translator's claim, not a status. Once someone has held the file,
     * their time and their delivery are recorded against it — the productivity report,
     * the payslip, the audit of who delivered what — and those projects are cancelled
     * instead. Without a claim a project can only be a draft, an available file or a
     * cancelled one, so the one check covers every status.
     *
     * Soft delete (docs/01): out of every list, but the files and history stay
     * recoverable, and the activity log still labels its rows.
     */
    public function destroy(Project $project): JsonResponse
    {
        $wasOnPortal = DB::transaction(function () use ($project): bool {
            // The same row lock a claim takes, so a claim landing in the same instant
            // is seen here — or finds the project already gone.
            /** @var Project $fresh */
            $fresh = Project::whereKey($project->getKey())->lockForUpdate()->firstOrFail();

            abort_if($fresh->assignments()->exists(), 422, __('projects.delete_after_claim'));

            // A converted quote request would point at nothing and refuse to convert
            // again. Hand it back as accepted — where it stood before converting.
            QuoteRequest::query()->where('project_id', $fresh->id)->get()->each->update([
                'project_id' => null,
                'status' => QuoteRequest::STATUS_ACCEPTED,
            ]);

            $fresh->delete();

            return $fresh->status === Project::STATUS_AVAILABLE;
        });

        if ($wasOnPortal) {
            $this->broadcastLive(new ProjectDeleted($project));
        }

        return response()->json(['message' => 'ok']);
    }

    public function timeline(Project $project): AnonymousResourceCollection
    {
        return TransitionResource::collection(
            $project->transitions()->with(['actor:id,name', 'attachments'])->get()
        );
    }
}
