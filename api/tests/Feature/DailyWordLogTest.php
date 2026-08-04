<?php

namespace Tests\Feature;

use App\Models\Assignment;
use App\Models\DailyWordLog;
use App\Models\Language;
use App\Models\Project;
use App\Models\User;
use Database\Seeders\LanguageSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * The self-declared daily word log and the two reports built on it.
 *
 * The whole point of the feature is that the declared number and the
 * system-counted number are shown side by side, so most of these tests assert
 * on the *gap* between them rather than on either one alone.
 */
class DailyWordLogTest extends TestCase
{
    use RefreshDatabase;

    private User $translator;

    private User $accountant;

    private Language $en;

    private Language $ar;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->seed(LanguageSeeder::class);

        $this->en = Language::where('code', 'en')->firstOrFail();
        $this->ar = Language::where('code', 'ar')->firstOrFail();

        $this->translator = User::factory()->create([
            'name' => 'سارة المترجمة',
            'monthly_word_target' => 45000,
        ]);
        $this->translator->syncRoles(['translator']);

        $this->accountant = User::factory()->create(['name' => 'محمود المحاسب']);
        $this->accountant->syncRoles(['accountant']);
    }

    /** A delivered assignment worth $words, credited on $deliveredAt. */
    private function deliver(User $translator, int $words, Carbon $deliveredAt): void
    {
        $project = Project::create([
            'code' => 'BM-2026-'.str_pad((string) random_int(1, 99999), 5, '0', STR_PAD_LEFT),
            'title' => 'مشروع إنتاجية',
            'source_language_id' => $this->en->id,
            'target_language_id' => $this->ar->id,
            'service_type' => 'certified',
            'priority' => 'normal',
            'status' => Project::STATUS_COMPLETED,
            'total_words' => $words,
            'deadline_at' => $deliveredAt->copy()->addDay(),
            'created_by' => $this->accountant->id,
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

    public function test_translator_records_a_day_and_resubmitting_overwrites_it(): void
    {
        $date = now()->subDay()->toDateString();

        $this->actingAs($this->translator, 'sanctum')
            ->postJson('/api/v1/portal/daily-words', ['work_date' => $date, 'declared_words' => 2400])
            ->assertOk()
            ->assertJsonPath('data.declared_words', 2400);

        $this->actingAs($this->translator, 'sanctum')
            ->postJson('/api/v1/portal/daily-words', [
                'work_date' => $date,
                'declared_words' => 2650,
                'note' => 'ملف صعب',
            ])
            ->assertOk()
            ->assertJsonPath('data.declared_words', 2650);

        $this->assertSame(1, DailyWordLog::where('user_id', $this->translator->id)->count());
        $this->assertSame('ملف صعب', DailyWordLog::first()->note);
    }

    public function test_future_dates_and_stale_backdating_are_rejected(): void
    {
        $this->actingAs($this->translator, 'sanctum')
            ->postJson('/api/v1/portal/daily-words', [
                'work_date' => now()->addDay()->toDateString(),
                'declared_words' => 3000,
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('work_date');

        $this->actingAs($this->translator, 'sanctum')
            ->postJson('/api/v1/portal/daily-words', [
                'work_date' => now()->subDays(90)->toDateString(),
                'declared_words' => 3000,
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('work_date');
    }

    /**
     * The client's own policy tops out under 7,000 words a day, so a five-figure
     * claim is a typo or a number nobody will honour. Rejected at the door.
     */
    public function test_an_impossible_daily_claim_is_rejected(): void
    {
        $this->actingAs($this->translator, 'sanctum')
            ->postJson('/api/v1/portal/daily-words', [
                'work_date' => now()->toDateString(),
                'declared_words' => 50000,
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('declared_words');
    }

    public function test_month_view_shows_declared_next_to_system_counted(): void
    {
        $day = now()->startOfMonth()->addDays(3)->setTime(12, 0);
        $this->deliver($this->translator, 6000, $day);

        DailyWordLog::create([
            'user_id' => $this->translator->id,
            'work_date' => $day->toDateString(),
            'declared_words' => 2500,
        ]);

        $data = $this->actingAs($this->translator, 'sanctum')
            ->getJson('/api/v1/portal/daily-words?month='.now()->format('Y-m'))
            ->assertOk()
            ->json('data');

        $row = collect($data['days'])->firstWhere('date', $day->toDateString());
        $this->assertSame(6000, $row['delivered_words']);
        $this->assertSame(2500, $row['declared_words']);
        $this->assertSame(-3500, $row['variance']);

        $this->assertSame(6000, $data['summary']['delivered_words']);
        $this->assertSame(2500, $data['summary']['declared_words']);
        $this->assertSame(45000, $data['summary']['monthly_target']);
        $this->assertSame(13, $data['summary']['achieved_pct']);
    }

    public function test_the_current_month_stops_at_today(): void
    {
        $data = $this->actingAs($this->translator, 'sanctum')
            ->getJson('/api/v1/portal/daily-words')
            ->assertOk()
            ->json('data');

        $lastDay = end($data['days'])['date'];
        $this->assertSame(now()->toDateString(), $lastDay);
        $this->assertLessThanOrEqual((int) now()->format('j'), count($data['days']));
    }

    public function test_a_past_month_still_renders_every_one_of_its_days(): void
    {
        $lastMonth = now()->subMonthNoOverflow();

        $data = $this->actingAs($this->translator, 'sanctum')
            ->getJson('/api/v1/portal/daily-words?month='.$lastMonth->format('Y-m'))
            ->assertOk()
            ->json('data');

        $this->assertCount($lastMonth->daysInMonth, $data['days']);
    }

    public function test_a_translator_only_ever_sees_their_own_log(): void
    {
        $other = User::factory()->create(['name' => 'خالد']);
        $other->syncRoles(['translator']);

        DailyWordLog::create([
            'user_id' => $other->id,
            'work_date' => now()->startOfMonth()->addDay()->toDateString(),
            'declared_words' => 9000,
        ]);

        $data = $this->actingAs($this->translator, 'sanctum')
            ->getJson('/api/v1/portal/daily-words')
            ->assertOk()
            ->json('data');

        $this->assertSame(0, $data['summary']['declared_words']);
        $this->assertSame(0, $data['summary']['days_logged']);
    }

    public function test_the_log_is_closed_to_everyone_without_portal_access(): void
    {
        $this->actingAs($this->accountant, 'sanctum')
            ->getJson('/api/v1/portal/daily-words')
            ->assertForbidden();

        $this->actingAs($this->accountant, 'sanctum')
            ->postJson('/api/v1/portal/daily-words', [
                'work_date' => now()->toDateString(),
                'declared_words' => 1000,
            ])
            ->assertForbidden();
    }

    public function test_productivity_report_compares_declaration_target_and_delivery(): void
    {
        $day = now()->startOfMonth()->addDays(2)->setTime(12, 0);
        $this->deliver($this->translator, 20000, $day);

        DailyWordLog::create([
            'user_id' => $this->translator->id,
            'work_date' => $day->toDateString(),
            'declared_words' => 5000,
        ]);

        $data = $this->actingAs($this->accountant, 'sanctum')
            ->getJson('/api/v1/reports/productivity?from='.now()->startOfMonth()->toDateString().'&to='.now()->toDateString())
            ->assertOk()
            ->json('data');

        $row = collect($data['rows'])->firstWhere('translator', 'سارة المترجمة');
        $this->assertSame(20000, $row['delivered_words']);
        $this->assertSame(5000, $row['declared_words']);
        $this->assertSame(-15000, $row['variance']);
        $this->assertSame(45000, $row['target']);
        $this->assertSame(44, $row['achieved_pct']);
    }

    public function test_daily_words_report_lists_both_sources_per_day(): void
    {
        $delivered = now()->startOfMonth()->addDays(1)->setTime(12, 0);
        $declaredOnly = now()->startOfMonth()->addDays(2);

        $this->deliver($this->translator, 4000, $delivered);
        DailyWordLog::create([
            'user_id' => $this->translator->id,
            'work_date' => $declaredOnly->toDateString(),
            'declared_words' => 2800,
        ]);

        $rows = $this->actingAs($this->accountant, 'sanctum')
            ->getJson('/api/v1/reports/daily_words?from='.now()->startOfMonth()->toDateString().'&to='.now()->toDateString())
            ->assertOk()
            ->json('data.rows');

        // A day with only a delivery, and a day with only a declaration — both appear.
        $this->assertCount(2, $rows);

        $deliveryRow = collect($rows)->firstWhere('date', $delivered->isoFormat('YYYY/MM/DD'));
        $this->assertSame(4000, $deliveryRow['delivered_words']);
        $this->assertNull($deliveryRow['declared_words']);

        $declaredRow = collect($rows)->firstWhere('date', $declaredOnly->isoFormat('YYYY/MM/DD'));
        $this->assertSame(0, $declaredRow['delivered_words']);
        $this->assertSame(2800, $declaredRow['declared_words']);
        $this->assertSame(2800, $declaredRow['variance']);
    }

    public function test_translators_cannot_read_the_productivity_report(): void
    {
        $this->actingAs($this->translator, 'sanctum')
            ->getJson('/api/v1/reports/productivity')
            ->assertForbidden();
    }

    public function test_admin_sets_the_monthly_target_on_a_translator(): void
    {
        $admin = User::factory()->create();
        $admin->syncRoles(['admin']);

        $this->actingAs($admin, 'sanctum')
            ->putJson("/api/v1/users/{$this->translator->id}", ['monthly_word_target' => 55000])
            ->assertOk()
            ->assertJsonPath('data.monthly_word_target', 55000);

        $this->assertSame(55000, $this->translator->fresh()->monthly_word_target);
    }
}
