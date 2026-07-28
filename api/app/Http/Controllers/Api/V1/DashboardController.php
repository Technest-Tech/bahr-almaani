<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Assignment;
use App\Models\Client;
use App\Models\Project;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class DashboardController extends Controller
{
    /** Statuses that count as "in the pipeline" for the headline KPI. */
    private const ACTIVE_STATUSES = [
        Project::STATUS_AVAILABLE,
        Project::STATUS_CLAIMED,
        Project::STATUS_DELIVERED,
        Project::STATUS_IN_REVIEW,
        Project::STATUS_REVISION_REQUESTED,
    ];

    /** Headline counters. Cached briefly — the dashboard is read far more than it changes. */
    public function summary(): JsonResponse
    {
        $data = Cache::remember('dashboard.summary', 60, function (): array {
            $byStatus = Project::query()
                ->selectRaw('status, COUNT(*) AS total')
                ->groupBy('status')
                ->pluck('total', 'status')
                ->map(fn ($count) => (int) $count);

            $monthStart = now()->startOfMonth();

            $completedThisMonth = Project::query()
                ->where('status', Project::STATUS_COMPLETED)
                ->where('completed_at', '>=', $monthStart)
                ->selectRaw('COUNT(*) AS projects, COALESCE(SUM(total_words), 0) AS words, COALESCE(SUM(total_pages), 0) AS pages')
                ->first();

            return [
                'statuses' => $byStatus,
                'active_total' => collect(self::ACTIVE_STATUSES)->sum(fn ($s) => $byStatus[$s] ?? 0),
                'late' => Project::late()->count(),
                'due_soon' => Project::query()
                    ->whereBetween('deadline_at', [now(), now()->addDay()])
                    ->whereNotIn('status', Project::SETTLED_STATUSES)
                    ->count(),
                'completed_this_month' => (int) $completedThisMonth->projects,
                'words_this_month' => (int) $completedThisMonth->words,
                'pages_this_month' => (int) $completedThisMonth->pages,
                'clients_total' => Client::count(),
                'translators_active' => User::role('translator')->where('status', User::STATUS_ACTIVE)->count(),
            ];
        });

        return response()->json(['data' => $data]);
    }

    /** Completed-per-day (30 days) and completed+words per ISO week (12 weeks), zero-filled. */
    public function throughput(): JsonResponse
    {
        $daily = Project::query()
            ->where('status', Project::STATUS_COMPLETED)
            ->where('completed_at', '>=', now()->subDays(29)->startOfDay())
            ->selectRaw("date_trunc('day', completed_at)::date AS day, COUNT(*) AS completed")
            ->groupBy('day')
            ->pluck('completed', 'day');

        // date_trunc('week') is ISO (Monday); Carbon's ar locale starts Saturday —
        // pin Monday explicitly or the zero-fill keys never match the SQL buckets.
        $weekly = Project::query()
            ->where('status', Project::STATUS_COMPLETED)
            ->where('completed_at', '>=', now()->subWeeks(11)->startOfWeek(Carbon::MONDAY))
            ->selectRaw("date_trunc('week', completed_at)::date AS week, COUNT(*) AS completed, COALESCE(SUM(total_words), 0) AS words")
            ->groupBy('week')
            ->get()
            ->keyBy(fn ($row) => (string) $row->week);

        return response()->json(['data' => [
            'daily' => collect(range(29, 0))->map(function (int $ago) use ($daily): array {
                $day = now()->subDays($ago)->toDateString();

                return ['date' => $day, 'completed' => (int) ($daily[$day] ?? 0)];
            })->values(),
            'weekly' => collect(range(11, 0))->map(function (int $ago) use ($weekly): array {
                $week = now()->subWeeks($ago)->startOfWeek(Carbon::MONDAY);
                $row = $weekly[$week->toDateString()] ?? null;

                return [
                    'week_start' => $week->toDateString(),
                    'label' => $week->isoFormat('GGGG-[W]WW'),
                    'completed' => (int) ($row->completed ?? 0),
                    'words' => (int) ($row->words ?? 0),
                ];
            })->values(),
        ]]);
    }

    /** Per-translator load: what they hold now + what they shipped this week. */
    public function workload(): JsonResponse
    {
        $weekStart = now()->startOfWeek();

        $translators = User::role('translator')
            ->where('status', User::STATUS_ACTIVE)
            ->orderBy('name')
            ->get(['id', 'name'])
            ->map(function (User $translator) use ($weekStart): array {
                $current = Assignment::query()
                    ->where('translator_id', $translator->id)
                    ->where(function ($query): void {
                        $query->where('status', Assignment::STATUS_ACTIVE)
                            ->orWhere(fn ($q) => $q
                                ->where('status', Assignment::STATUS_DELIVERED)
                                ->whereHas('project', fn ($p) => $p->where('status', Project::STATUS_REVISION_REQUESTED)));
                    })
                    ->with('project:id,code,title,priority,status,deadline_at')
                    ->latest('claimed_at')
                    ->first();

                $week = Assignment::query()
                    ->where('translator_id', $translator->id)
                    ->where('status', Assignment::STATUS_DELIVERED)
                    ->where('delivered_at', '>=', $weekStart)
                    ->selectRaw('COUNT(*) AS delivered, COALESCE(SUM(work_seconds), 0) AS seconds')
                    ->first();

                return [
                    'id' => $translator->id,
                    'name' => $translator->name,
                    'current' => $current ? [
                        'project_id' => $current->project->id,
                        'code' => $current->project->code,
                        'title' => $current->project->title,
                        'priority' => $current->project->priority,
                        'status' => $current->project->status,
                        'deadline_at' => $current->project->deadline_at->toIso8601String(),
                        'is_late' => $current->project->isLate(),
                        'claimed_at' => $current->claimed_at?->toIso8601String(),
                    ] : null,
                    'delivered_this_week' => (int) $week->delivered,
                    'work_seconds_this_week' => (int) $week->seconds,
                ];
            });

        return response()->json(['data' => $translators]);
    }

    /** Attention list: already late + due within 24h, most urgent first. */
    public function late(): JsonResponse
    {
        $present = fn (Project $project, Carbon $now): array => [
            'id' => $project->id,
            'code' => $project->code,
            'title' => $project->title,
            'status' => $project->status,
            'priority' => $project->priority,
            'deadline_at' => $project->deadline_at->toIso8601String(),
            'client' => $project->client?->name,
            'translator' => $project->assignments->first()?->translator?->name,
            'hours' => (int) round(abs($now->diffInMinutes($project->deadline_at, false)) / 60),
        ];

        $now = now();
        $withRefs = fn ($query) => $query
            ->with([
                'client:id,name',
                'assignments' => fn ($q) => $q->where('status', Assignment::STATUS_ACTIVE)->with('translator:id,name'),
            ])
            ->orderBy('deadline_at')
            ->limit(50);

        return response()->json(['data' => [
            'late' => $withRefs(Project::late())->get()->map(fn ($p) => $present($p, $now)),
            'due_soon' => $withRefs(
                Project::query()
                    ->whereBetween('deadline_at', [$now, $now->copy()->addDay()])
                    ->whereNotIn('status', Project::SETTLED_STATUSES),
            )->get()->map(fn ($p) => $present($p, $now)),
        ]]);
    }
}
