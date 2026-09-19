<?php

namespace Tests\Feature;

use App\Models\Assignment;
use App\Models\Language;
use App\Models\Project;
use App\Models\Setting;
use App\Models\User;
use App\Notifications\DeadlineAlertNotification;
use App\Support\Timezone;
use Database\Seeders\LanguageSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * The office reads a Cairo wall clock; the database stores UTC. Both halves are
 * load-bearing, and the failure mode of confusing them is silent, so each one is
 * pinned here.
 *
 * Context: production ran for six weeks with `APP_TIMEZONE=Africa/Cairo` set in
 * .env and completely inert, because config/app.php hardcoded 'UTC' — deadline
 * notifications announced a 19:00 Cairo deadline as 16:00. The tempting fix is to
 * point config('app.timezone') at Cairo, which quietly corrupts every new write.
 * These tests exist to make that second mistake fail loudly.
 */
class TimezoneTest extends TestCase
{
    use RefreshDatabase;

    public function test_storage_timezone_stays_utc(): void
    {
        // Columns are timestamptz on a UTC Postgres session. If Eloquent ever
        // formats a Cairo wall clock into them the offset is dropped on the way
        // out and re-read as UTC — every row three hours into the future.
        $this->assertSame('UTC', config('app.timezone'));
        $this->assertSame('UTC', date_default_timezone_get());
        $this->assertSame('UTC', now()->timezoneName);
    }

    public function test_display_timezone_is_cairo_and_is_not_the_storage_timezone(): void
    {
        $this->assertSame('Africa/Cairo', Timezone::display());
        $this->assertNotSame(config('app.timezone'), Timezone::display());
    }

    public function test_display_timezone_is_admin_overridable(): void
    {
        Setting::set('work_timezone', 'Asia/Riyadh');

        $this->assertSame('Asia/Riyadh', Timezone::display());
    }

    public function test_display_timezone_rejects_anything_not_in_the_zone_database(): void
    {
        // Callers interpolate this straight into SQL (`AT TIME ZONE '…'`).
        Setting::set('work_timezone', "Africa/Cairo'; DROP TABLE projects; --");

        $this->assertSame('UTC', Timezone::display());
        $this->assertTrue(DB::getSchemaBuilder()->hasTable('projects'));
    }

    public function test_a_late_night_cairo_instant_renders_on_the_cairo_day_not_the_utc_one(): void
    {
        // 01:00 Cairo on the 17th is still 22:00 UTC on the 16th — the case that
        // dated invoices and report deadlines a day early.
        $instant = Carbon::parse('2026-09-16 22:00:00', 'UTC');

        $this->assertSame('2026/09/16', $instant->isoFormat('YYYY/MM/DD'));
        $this->assertSame(
            '2026/09/17',
            $instant->copy()->timezone(Timezone::display())->isoFormat('YYYY/MM/DD'),
        );
    }

    public function test_cairo_is_three_hours_ahead_in_summer_and_two_in_winter(): void
    {
        // Egypt reinstated DST in 2023, so the offset is not a constant and
        // nothing may hardcode +02:00 or +03:00.
        $summer = Carbon::parse('2026-09-16 12:00:00', 'UTC')->timezone(Timezone::display());
        $winter = Carbon::parse('2026-01-16 12:00:00', 'UTC')->timezone(Timezone::display());

        $this->assertSame(180, $summer->utcOffset());
        $this->assertSame(120, $winter->utcOffset());
    }

    public function test_the_deadline_notification_announces_the_cairo_hour(): void
    {
        // The regression this whole change exists for: a project due 19:00 Cairo
        // was announced to the PM and every translator as 16:00.
        $this->seed(LanguageSeeder::class);

        // toMail() only reads the recipient's name, so no role is needed here.
        $pm = User::factory()->create();

        $project = Project::create([
            'code' => 'BM-2026-00001',
            'title' => 'عقد تأسيس',
            'source_language_id' => Language::where('code', 'en')->firstOrFail()->id,
            'target_language_id' => Language::where('code', 'ar')->firstOrFail()->id,
            'service_type' => 'certified',
            'priority' => 'normal',
            'status' => Project::STATUS_CLAIMED,
            'deadline_at' => Carbon::parse('2026-09-16 16:00:00', 'UTC'),
            'created_by' => $pm->id,
            'published_at' => now(),
        ]);

        $mail = (new DeadlineAlertNotification($project, 'late'))->toMail($pm);
        $lines = collect($mail->introLines)->concat($mail->outroLines)->implode(' ');

        $this->assertStringContainsString('2026-09-16 19:00', $lines);
        $this->assertStringNotContainsString('2026-09-16 16:00', $lines);
    }

    public function test_a_translator_can_log_today_just_after_cairo_midnight(): void
    {
        // 01:00 Cairo on the 17th is 22:00 UTC on the 16th. The night shift
        // logging "today" was told it was a future date.
        $this->seed(RolesAndPermissionsSeeder::class);
        $translator = User::factory()->create();
        $translator->syncRoles(['translator']);

        $this->travelTo(Carbon::parse('2026-09-16 22:00:00', 'UTC'));

        $this->actingAs($translator, 'sanctum')
            ->getJson('/api/v1/portal/daily-words')
            ->assertOk()
            ->assertJsonPath('data.limits.latest_date', '2026-09-17')
            ->assertJsonPath('data.to', '2026-09-17');

        $this->actingAs($translator, 'sanctum')
            ->postJson('/api/v1/portal/daily-words', ['work_date' => '2026-09-17', 'declared_words' => 1200])
            ->assertOk();

        $this->actingAs($translator, 'sanctum')
            ->postJson('/api/v1/portal/daily-words', ['work_date' => '2026-09-18', 'declared_words' => 1200])
            ->assertStatus(422)
            ->assertJsonValidationErrors('work_date');
    }

    public function test_a_report_month_is_cut_on_cairo_midnights(): void
    {
        // Deliveries at 01:00 Cairo on 1 September and 1 October are 22:00 UTC
        // the evening before. The September report must hold the first and not
        // the second — cut on UTC midnights it did exactly the opposite.
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->seed(LanguageSeeder::class);

        $accountant = User::factory()->create();
        $accountant->syncRoles(['accountant']);
        $translator = User::factory()->create();
        $translator->syncRoles(['translator']);

        foreach (['2026-08-31 22:00:00' => 1000, '2026-09-30 22:00:00' => 7] as $utc => $words) {
            $deliveredAt = Carbon::parse($utc, 'UTC');

            $project = Project::create([
                'code' => 'BM-2026-'.str_pad((string) $words, 5, '0', STR_PAD_LEFT),
                'title' => 'تسليم بعد منتصف الليل',
                'source_language_id' => Language::where('code', 'en')->firstOrFail()->id,
                'target_language_id' => Language::where('code', 'ar')->firstOrFail()->id,
                'service_type' => 'certified',
                'priority' => 'normal',
                'status' => Project::STATUS_COMPLETED,
                'total_words' => $words,
                'deadline_at' => $deliveredAt->copy()->addDay(),
                'created_by' => $accountant->id,
            ]);

            Assignment::create([
                'project_id' => $project->id,
                'translator_id' => $translator->id,
                'status' => Assignment::STATUS_DELIVERED,
                'claimed_at' => $deliveredAt->copy()->subDay(),
                'delivered_at' => $deliveredAt,
                'work_seconds' => 3600,
            ]);
        }

        $rows = $this->actingAs($accountant, 'sanctum')
            ->getJson('/api/v1/reports/daily_words?from=2026-09-01&to=2026-09-30')
            ->assertOk()
            ->json('data.rows');

        $this->assertSame(['2026/09/01'], array_column($rows, 'date'));
        $this->assertSame(1000, $rows[0]['delivered_words']);
    }
}
