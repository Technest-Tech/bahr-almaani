<?php

namespace App\Services;

use App\Models\Assignment;
use App\Models\Project;
use App\Models\StatusTransition;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * The four M7 report queries. Each returns display-ready rows (plain arrays)
 * consumed by BOTH the JSON endpoints and the export files, so the numbers
 * on screen and in Excel/PDF can never disagree.
 */
class ReportService
{
    public const TYPES = ['translators', 'pms', 'monthly', 'projects'];

    /** @return array{columns: array<string,string>, rows: Collection} */
    public function build(string $type, array $params): array
    {
        $from = Carbon::parse($params['from'] ?? now()->startOfMonth())->startOfDay();
        $to = Carbon::parse($params['to'] ?? now())->endOfDay();

        return match ($type) {
            'translators' => $this->translators($from, $to),
            'pms' => $this->pms($from, $to),
            'monthly' => $this->monthly($from, $to),
            'projects' => $this->projects($from, $to, $params),
        };
    }

    /** Per-translator output for deliveries inside the range. */
    private function translators(Carbon $from, Carbon $to): array
    {
        $rows = User::role('translator')
            ->orderBy('name')
            ->get(['id', 'name'])
            ->map(function (User $translator) use ($from, $to): array {
                $delivered = Assignment::query()
                    ->where('assignments.translator_id', $translator->id)
                    ->where('assignments.status', Assignment::STATUS_DELIVERED)
                    ->whereBetween('assignments.delivered_at', [$from, $to]);

                $totals = (clone $delivered)
                    ->join('projects', 'projects.id', '=', 'assignments.project_id')
                    ->selectRaw('COUNT(*) AS files, COALESCE(SUM(projects.total_words), 0) AS words, COALESCE(SUM(projects.total_pages), 0) AS pages, COALESCE(SUM(assignments.work_seconds), 0) AS seconds')
                    ->first();

                return [
                    'translator' => $translator->name,
                    'files' => (int) $totals->files,
                    'words' => (int) $totals->words,
                    'pages' => (int) $totals->pages,
                    'hours' => round(((int) $totals->seconds) / 3600, 1),
                ];
            })
            ->filter(fn (array $row) => $row['files'] > 0)
            ->values();

        return [
            'columns' => [
                'translator' => 'المترجم',
                'files' => 'الملفات المسلّمة',
                'words' => 'الكلمات',
                'pages' => 'الصفحات',
                'hours' => 'ساعات العمل',
            ],
            'rows' => $rows,
        ];
    }

    /** Per-PM portfolio quality for projects created inside the range. */
    private function pms(Carbon $from, Carbon $to): array
    {
        $rows = User::role(['project_manager', 'admin'])
            ->orderBy('name')
            ->get(['id', 'name'])
            ->map(function (User $pm) use ($from, $to): array {
                $created = Project::query()
                    ->where('created_by', $pm->id)
                    ->whereBetween('created_at', [$from, $to]);

                $total = (clone $created)->count();
                $completed = (clone $created)->where('status', Project::STATUS_COMPLETED);
                $completedCount = (clone $completed)->count();
                $onTime = (clone $completed)->whereColumn('completed_at', '<=', 'deadline_at')->count();

                $delivered = (clone $created)
                    ->whereHas('transitions', fn ($q) => $q->where('to_status', Project::STATUS_DELIVERED))
                    ->count();
                $revised = StatusTransition::query()
                    ->where('to_status', Project::STATUS_REVISION_REQUESTED)
                    ->whereIn('project_id', (clone $created)->select('id'))
                    ->distinct('project_id')
                    ->count('project_id');

                return [
                    'pm' => $pm->name,
                    'projects' => $total,
                    'completed' => $completedCount,
                    'on_time_pct' => $completedCount > 0 ? round($onTime * 100 / $completedCount) : null,
                    'revision_pct' => $delivered > 0 ? round($revised * 100 / $delivered) : null,
                ];
            })
            ->filter(fn (array $row) => $row['projects'] > 0)
            ->values();

        return [
            'columns' => [
                'pm' => 'مدير المشروع',
                'projects' => 'مشاريع منشأة',
                'completed' => 'مكتملة',
                'on_time_pct' => 'الالتزام بالموعد ٪',
                'revision_pct' => 'نسبة التعديلات ٪',
            ],
            'rows' => $rows,
        ];
    }

    /** Company summary per calendar month across the range. */
    private function monthly(Carbon $from, Carbon $to): array
    {
        $months = collect();
        for ($cursor = $from->copy()->startOfMonth(); $cursor <= $to; $cursor->addMonth()) {
            $start = $cursor->copy();
            $end = $cursor->copy()->endOfMonth()->min($to);

            $completed = Project::query()
                ->where('status', Project::STATUS_COMPLETED)
                ->whereBetween('completed_at', [$start, $end]);

            $totals = (clone $completed)
                ->selectRaw('COUNT(*) AS completed, COALESCE(SUM(total_words), 0) AS words, COALESCE(SUM(total_pages), 0) AS pages, COALESCE(SUM(quoted_amount), 0) AS amount')
                ->first();

            $months->push([
                'month' => $start->isoFormat('YYYY/MM'),
                'created' => Project::whereBetween('created_at', [$start, $end])->count(),
                'completed' => (int) $totals->completed,
                'words' => (int) $totals->words,
                'pages' => (int) $totals->pages,
                'amount' => (float) $totals->amount,
            ]);
        }

        return [
            'columns' => [
                'month' => 'الشهر',
                'created' => 'مشاريع جديدة',
                'completed' => 'مكتملة',
                'words' => 'الكلمات',
                'pages' => 'الصفحات',
                'amount' => 'قيمة الأعمال المكتملة',
            ],
            'rows' => $months,
        ];
    }

    /** Filterable project registry (created inside the range). */
    private function projects(Carbon $from, Carbon $to, array $params): array
    {
        $rows = Project::query()
            ->with(['client:id,name', 'sourceLanguage', 'targetLanguage'])
            ->whereBetween('created_at', [$from, $to])
            ->when(! empty($params['status']), fn ($q) => $q->where('status', $params['status']))
            ->when(! empty($params['client_id']), fn ($q) => $q->where('client_id', $params['client_id']))
            ->orderByDesc('created_at')
            ->limit(2000)
            ->get()
            ->map(fn (Project $project): array => [
                'code' => $project->code,
                'title' => $project->title,
                'client' => $project->client?->name,
                'pair' => "{$project->sourceLanguage->name_ar} ← {$project->targetLanguage->name_ar}",
                'status' => __("projects.status.{$project->status}"),
                'words' => $project->total_words,
                'deadline' => $project->deadline_at->isoFormat('YYYY/MM/DD'),
                'amount' => $project->quoted_amount !== null ? (float) $project->quoted_amount : null,
            ]);

        return [
            'columns' => [
                'code' => 'الكود',
                'title' => 'العنوان',
                'client' => 'العميل',
                'pair' => 'اللغات',
                'status' => 'الحالة',
                'words' => 'الكلمات',
                'deadline' => 'الموعد',
                'amount' => 'المبلغ',
            ],
            'rows' => $rows,
        ];
    }
}
