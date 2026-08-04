<?php

namespace App\Services;

use App\Models\Assignment;
use App\Models\DailyWordLog;
use App\Models\Setting;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * The two sources of "how many words did this translator do".
 *
 *  - **delivered** — what the system counted itself, credited on the day the
 *    file was delivered. Authoritative, but lumpy: a file claimed Monday and
 *    delivered Thursday puts every word on Thursday.
 *  - **declared** — what the translator typed for that day. Smooth, but
 *    self-reported.
 *
 * Neither is "the" number, which is exactly why every screen shows both and the
 * variance between them. Anything that turns these into money is out of scope
 * (docs/HANDOFF.md §7b) — this service reports, it never pays.
 */
class ProductionService
{
    /**
     * Which day a delivery belongs to. `delivered_at` is timestamptz and the app
     * runs on UTC, so a 01:00 Cairo delivery would otherwise be filed under the
     * previous day — a real off-by-one on numbers people are paid against.
     */
    public function workTimezone(): string
    {
        $timezone = (string) Setting::get('work_timezone', 'Africa/Cairo');

        // Whitelisted before it reaches SQL below, where it is interpolated.
        return in_array($timezone, timezone_identifiers_list(), true) ? $timezone : 'UTC';
    }

    /**
     * System-counted words per translator per day inside the range.
     *
     * Mirrors the M7 translator report's query (same join, same status filter)
     * so the two reports can never disagree about a total.
     *
     * @param  list<int>|null  $translatorIds  null = every translator
     * @return Collection<string, array{words: int, files: int, seconds: int}> keyed "{translatorId}|{Y-m-d}"
     */
    public function deliveredByDay(Carbon $from, Carbon $to, ?array $translatorIds = null): Collection
    {
        $day = "(assignments.delivered_at AT TIME ZONE '{$this->workTimezone()}')::date";

        return Assignment::query()
            ->join('projects', 'projects.id', '=', 'assignments.project_id')
            ->where('assignments.status', Assignment::STATUS_DELIVERED)
            ->whereBetween('assignments.delivered_at', [$from, $to])
            ->when($translatorIds !== null, fn ($q) => $q->whereIn('assignments.translator_id', $translatorIds))
            ->selectRaw("assignments.translator_id, {$day} AS work_date")
            ->selectRaw('COUNT(*) AS files, COALESCE(SUM(projects.total_words), 0) AS words, COALESCE(SUM(assignments.work_seconds), 0) AS seconds')
            ->groupByRaw("assignments.translator_id, {$day}")
            ->get()
            ->mapWithKeys(fn ($row) => [
                $row->translator_id.'|'.Carbon::parse($row->work_date)->toDateString() => [
                    'words' => (int) $row->words,
                    'files' => (int) $row->files,
                    'seconds' => (int) $row->seconds,
                ],
            ]);
    }

    /**
     * Self-declared words per translator per day inside the range.
     *
     * @param  list<int>|null  $translatorIds  null = every translator
     * @return Collection<string, array{words: int, note: string|null}> keyed "{translatorId}|{Y-m-d}"
     */
    public function declaredByDay(Carbon $from, Carbon $to, ?array $translatorIds = null): Collection
    {
        return DailyWordLog::query()
            ->whereBetween('work_date', [$from->toDateString(), $to->toDateString()])
            ->when($translatorIds !== null, fn ($q) => $q->whereIn('user_id', $translatorIds))
            ->get(['user_id', 'work_date', 'declared_words', 'note'])
            ->mapWithKeys(fn (DailyWordLog $log) => [
                $log->user_id.'|'.$log->work_date->toDateString() => [
                    'words' => $log->declared_words,
                    'note' => $log->note,
                ],
            ]);
    }

    /**
     * One row per calendar day in the range for a single translator: what the
     * system counted, what they declared, and the gap.
     *
     * @return list<array{date: string, delivered_words: int, declared_words: int|null, variance: int|null, files: int, note: string|null}>
     */
    public function dailyBreakdown(int $translatorId, Carbon $from, Carbon $to): array
    {
        $delivered = $this->deliveredByDay($from, $to, [$translatorId]);
        $declared = $this->declaredByDay($from, $to, [$translatorId]);

        $rows = [];

        for ($day = $from->copy()->startOfDay(); $day->lte($to); $day->addDay()) {
            $key = $translatorId.'|'.$day->toDateString();
            $deliveredWords = $delivered[$key]['words'] ?? 0;
            $declaredWords = $declared[$key]['words'] ?? null;

            $rows[] = [
                'date' => $day->toDateString(),
                'delivered_words' => $deliveredWords,
                'declared_words' => $declaredWords,
                'variance' => $declaredWords === null ? null : $declaredWords - $deliveredWords,
                'files' => $delivered[$key]['files'] ?? 0,
                'note' => $declared[$key]['note'] ?? null,
            ];
        }

        return $rows;
    }
}
