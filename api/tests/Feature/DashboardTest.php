<?php

namespace Tests\Feature;

use App\Models\Assignment;
use App\Models\Language;
use App\Models\Project;
use App\Models\User;
use Database\Seeders\LanguageSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class DashboardTest extends TestCase
{
    use RefreshDatabase;

    private User $pm;

    private User $translator;

    private Language $en;

    private Language $ar;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->seed(LanguageSeeder::class);
        Cache::flush(); // summary is cached 60s; array store persists across tests

        $this->en = Language::where('code', 'en')->firstOrFail();
        $this->ar = Language::where('code', 'ar')->firstOrFail();

        $this->pm = User::factory()->create();
        $this->pm->syncRoles(['project_manager']);

        $this->translator = User::factory()->create(['name' => 'سارة المترجمة']);
        $this->translator->syncRoles(['translator']);
        $this->translator->languagePairs()->create([
            'source_language_id' => $this->en->id,
            'target_language_id' => $this->ar->id,
        ]);
    }

    private function makeProject(array $overrides = []): Project
    {
        // completed_at is intentionally not fillable (only the transition
        // service writes it in prod) — set it explicitly after create.
        $completedAt = $overrides['completed_at'] ?? null;
        unset($overrides['completed_at']);

        $project = Project::create(array_merge([
            'code' => 'BM-2026-'.str_pad((string) random_int(1, 99999), 5, '0', STR_PAD_LEFT),
            'title' => 'مشروع لوحة التحكم',
            'source_language_id' => $this->en->id,
            'target_language_id' => $this->ar->id,
            'service_type' => 'certified',
            'priority' => 'normal',
            'status' => Project::STATUS_AVAILABLE,
            'deadline_at' => now()->addDays(2),
            'created_by' => $this->pm->id,
        ], $overrides));

        if ($completedAt !== null) {
            $project->forceFill(['completed_at' => $completedAt])->save();
        }

        return $project;
    }

    public function test_summary_counts_statuses_late_and_monthly_totals(): void
    {
        $this->makeProject(); // available, on time
        $this->makeProject(['status' => Project::STATUS_CLAIMED, 'deadline_at' => now()->subHours(3)]); // late
        $this->makeProject(['status' => Project::STATUS_DRAFT]);
        $this->makeProject(['deadline_at' => now()->addHours(5)]); // due soon
        $this->makeProject([
            'status' => Project::STATUS_COMPLETED,
            'completed_at' => now()->subDays(2),
            'total_words' => 1200,
            'total_pages' => 4,
        ]);
        // Cancelled + past deadline: settled, must NOT count as late.
        $this->makeProject(['status' => Project::STATUS_CANCELLED, 'deadline_at' => now()->subDay()]);

        $response = $this->actingAs($this->pm, 'sanctum')->getJson('/api/v1/dashboard/summary');

        $response->assertOk()
            ->assertJsonPath('data.statuses.available', 2)
            ->assertJsonPath('data.statuses.claimed', 1)
            ->assertJsonPath('data.statuses.draft', 1)
            ->assertJsonPath('data.active_total', 3)
            ->assertJsonPath('data.late', 1)
            ->assertJsonPath('data.due_soon', 1)
            ->assertJsonPath('data.completed_this_month', 1)
            ->assertJsonPath('data.words_this_month', 1200)
            ->assertJsonPath('data.pages_this_month', 4)
            ->assertJsonPath('data.translators_active', 1);
    }

    public function test_throughput_buckets_completions_and_zero_fills(): void
    {
        // Fixed midday stamps: relative offsets near midnight would straddle day buckets.
        $this->makeProject([
            'status' => Project::STATUS_COMPLETED,
            'completed_at' => now()->subDay()->setTime(12, 0),
            'total_words' => 500,
        ]);
        $this->makeProject([
            'status' => Project::STATUS_COMPLETED,
            'completed_at' => now()->subDay()->setTime(11, 0),
            'total_words' => 300,
        ]);
        $this->makeProject([
            'status' => Project::STATUS_COMPLETED,
            'completed_at' => now()->subDays(120), // outside both windows (30d / 12w)
        ]);

        $data = $this->actingAs($this->pm, 'sanctum')
            ->getJson('/api/v1/dashboard/throughput')
            ->assertOk()
            ->json('data');

        $this->assertCount(30, $data['daily']);
        $this->assertCount(12, $data['weekly']);

        $yesterday = collect($data['daily'])->firstWhere('date', now()->subDay()->toDateString());
        $this->assertSame(2, $yesterday['completed']);

        $this->assertSame(2, collect($data['weekly'])->sum('completed'));
        $this->assertSame(800, collect($data['weekly'])->sum('words'));
    }

    public function test_workload_shows_current_file_and_weekly_output(): void
    {
        $current = $this->makeProject(['status' => Project::STATUS_CLAIMED, 'deadline_at' => now()->subHour()]);
        Assignment::create([
            'project_id' => $current->id,
            'translator_id' => $this->translator->id,
            'status' => Assignment::STATUS_ACTIVE,
            'claimed_at' => now()->subHours(5),
        ]);

        $shipped = $this->makeProject(['status' => Project::STATUS_COMPLETED, 'completed_at' => now()]);
        Assignment::create([
            'project_id' => $shipped->id,
            'translator_id' => $this->translator->id,
            'status' => Assignment::STATUS_DELIVERED,
            'claimed_at' => now()->subDays(2),
            'delivered_at' => now()->subDay(),
            'work_seconds' => 7200,
        ]);

        $rows = $this->actingAs($this->pm, 'sanctum')
            ->getJson('/api/v1/dashboard/workload')
            ->assertOk()
            ->json('data');

        $row = collect($rows)->firstWhere('id', $this->translator->id);
        $this->assertSame($current->code, $row['current']['code']);
        $this->assertTrue($row['current']['is_late']);
        $this->assertSame(1, $row['delivered_this_week']);
        $this->assertSame(7200, $row['work_seconds_this_week']);
    }

    public function test_late_endpoint_separates_late_from_due_soon(): void
    {
        $late = $this->makeProject(['deadline_at' => now()->subHours(30)]);
        $dueSoon = $this->makeProject(['deadline_at' => now()->addHours(6)]);
        $this->makeProject(['deadline_at' => now()->addDays(5)]); // neither

        $data = $this->actingAs($this->pm, 'sanctum')
            ->getJson('/api/v1/dashboard/late')
            ->assertOk()
            ->json('data');

        $this->assertCount(1, $data['late']);
        $this->assertSame($late->code, $data['late'][0]['code']);
        $this->assertSame(30, $data['late'][0]['hours']);

        $this->assertCount(1, $data['due_soon']);
        $this->assertSame($dueSoon->code, $data['due_soon'][0]['code']);
    }

    public function test_dashboard_requires_permission(): void
    {
        $this->actingAs($this->translator, 'sanctum')
            ->getJson('/api/v1/dashboard/summary')
            ->assertForbidden();
    }

    public function test_accountant_can_view_dashboard(): void
    {
        $accountant = User::factory()->create();
        $accountant->syncRoles(['accountant']);

        $this->actingAs($accountant, 'sanctum')
            ->getJson('/api/v1/dashboard/summary')
            ->assertOk();
    }
}
