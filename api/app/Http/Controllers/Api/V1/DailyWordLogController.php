<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\DailyWordLog;
use App\Services\ProductionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * The translator's own daily word log — personal, like notification
 * preferences, so it carries no permission of its own beyond `portal.access`.
 * Nobody edits anybody else's day here; managers read the numbers through the
 * reports instead.
 */
class DailyWordLogController extends Controller
{
    /**
     * A self-declared day cannot be in the future, cannot be back-dated past
     * this window, and cannot be absurd. The top bonus band in the client's
     * own policy is under 7,000 words, so five figures is a typo or a claim
     * nobody will honour — better rejected at the door than argued about later.
     */
    private const BACKDATE_DAYS = 45;

    private const MAX_DECLARED_WORDS = 20000;

    public function __construct(
        private readonly ProductionService $production,
    ) {}

    /** The caller's month: one row per day, declared next to system-counted. */
    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'month' => ['nullable', 'date_format:Y-m'],
        ]);

        $user = $request->user();
        $from = Carbon::parse(($validated['month'] ?? now()->format('Y-m')).'-01')->startOfMonth();

        // The current month stops at today: a row for the 27th of a month that
        // has not happened yet is an input nobody can use.
        $today = now()->setTimezone($this->production->workTimezone())->startOfDay();
        $to = $from->copy()->endOfMonth()->min($today);

        $days = $this->production->dailyBreakdown($user->id, $from, $to->copy()->endOfDay());

        $deliveredTotal = array_sum(array_column($days, 'delivered_words'));
        $declaredTotal = array_sum(array_map(fn ($d) => $d['declared_words'] ?? 0, $days));
        $target = $user->monthly_word_target;

        return response()->json(['data' => [
            'month' => $from->format('Y-m'),
            'from' => $from->toDateString(),
            'to' => $to->toDateString(),
            'days' => $days,
            'summary' => [
                'delivered_words' => $deliveredTotal,
                'declared_words' => $declaredTotal,
                'variance' => $declaredTotal - $deliveredTotal,
                'monthly_target' => $target,
                'achieved_pct' => $target > 0 ? round($deliveredTotal * 100 / $target) : null,
                'days_logged' => count(array_filter($days, fn ($d) => $d['declared_words'] !== null)),
                'days_delivered' => count(array_filter($days, fn ($d) => $d['delivered_words'] > 0)),
            ],
            'limits' => [
                'max_declared_words' => self::MAX_DECLARED_WORDS,
                'earliest_date' => now()->subDays(self::BACKDATE_DAYS)->toDateString(),
                'latest_date' => now()->toDateString(),
            ],
        ]]);
    }

    /** Record (or overwrite) one day. Every edit is activity-logged. */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'work_date' => [
                'required', 'date_format:Y-m-d',
                'after_or_equal:'.now()->subDays(self::BACKDATE_DAYS)->toDateString(),
                'before_or_equal:'.now()->toDateString(),
            ],
            'declared_words' => ['required', 'integer', 'min:0', 'max:'.self::MAX_DECLARED_WORDS],
            'note' => ['nullable', 'string', 'max:500'],
        ]);

        $log = DailyWordLog::updateOrCreate(
            ['user_id' => $request->user()->id, 'work_date' => $validated['work_date']],
            ['declared_words' => $validated['declared_words'], 'note' => $validated['note'] ?? null],
        );

        return response()->json([
            'data' => [
                'date' => $log->work_date->toDateString(),
                'declared_words' => $log->declared_words,
                'note' => $log->note,
            ],
            'message' => __('production.day_saved'),
        ]);
    }
}
