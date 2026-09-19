<?php

namespace App\Support;

use App\Models\Setting;
use Illuminate\Support\Carbon;

/**
 * The one answer to "which wall clock do the people here read".
 *
 * **Storage stays UTC, and has to.** Every timestamp column is `timestamptz`
 * while Postgres's session runs on UTC. Moving `config('app.timezone')` to
 * Africa/Cairo — the obvious fix, and what `APP_TIMEZONE` in .env looks like it
 * should do — would make Eloquent hand Postgres a Cairo wall clock with the
 * offset dropped (`Y-m-d H:i:s`), which comes back read as UTC: every new row
 * three hours into the future. Verified against production before this was
 * written.
 *
 * So Cairo is applied at the edges — on the way out to a human, and on the way
 * in from one — and nowhere in between.
 */
final class Timezone
{
    public const FALLBACK = 'Africa/Cairo';

    /**
     * Admin-settable via the `work_timezone` setting, defaulted from
     * `APP_TIMEZONE`, and whitelisted against the zone database because callers
     * interpolate it into SQL (`AT TIME ZONE '…'`).
     */
    public static function display(): string
    {
        $timezone = (string) Setting::get('work_timezone', config('app.display_timezone', self::FALLBACK));

        return in_array($timezone, timezone_identifiers_list(), true) ? $timezone : 'UTC';
    }

    /** Now, on the office wall clock — the one "today", "this week" and "this month" mean. */
    public static function now(): Carbon
    {
        return Carbon::now(self::display());
    }

    /**
     * A range of office-clock edges as the UTC instants they really are, ready
     * for `whereBetween`. A zoned Carbon handed to the query builder is formatted
     * without its offset and read back as UTC, so Cairo midnight would silently
     * become 00:00 UTC — the 01:00 Cairo delivery lands in the wrong report.
     *
     * @return array{0: Carbon, 1: Carbon}
     */
    public static function between(Carbon $from, Carbon $to): array
    {
        return [$from->copy()->utc(), $to->copy()->utc()];
    }
}
