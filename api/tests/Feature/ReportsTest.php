<?php

namespace Tests\Feature;

use App\Models\Assignment;
use App\Models\Client;
use App\Models\Language;
use App\Models\Project;
use App\Models\ReportExport;
use App\Models\User;
use App\Notifications\ReportReadyNotification;
use Database\Seeders\LanguageSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ReportsTest extends TestCase
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
        Storage::fake('local');

        $this->en = Language::where('code', 'en')->firstOrFail();
        $this->ar = Language::where('code', 'ar')->firstOrFail();

        $this->pm = User::factory()->create(['name' => 'منى المديرة']);
        $this->pm->syncRoles(['project_manager']);

        $this->translator = User::factory()->create(['name' => 'سارة المترجمة']);
        $this->translator->syncRoles(['translator']);
    }

    private function makeProject(array $overrides = []): Project
    {
        $completedAt = $overrides['completed_at'] ?? null;
        unset($overrides['completed_at']);

        $project = Project::create(array_merge([
            'code' => 'BM-2026-'.str_pad((string) random_int(1, 99999), 5, '0', STR_PAD_LEFT),
            'title' => 'مشروع تقرير',
            'source_language_id' => $this->en->id,
            'target_language_id' => $this->ar->id,
            'service_type' => 'certified',
            'priority' => 'normal',
            'status' => Project::STATUS_COMPLETED,
            'deadline_at' => now()->addDays(2),
            'created_by' => $this->pm->id,
        ], $overrides));

        if ($completedAt !== null) {
            $project->forceFill(['completed_at' => $completedAt])->save();
        }

        return $project;
    }

    public function test_translators_report_aggregates_output(): void
    {
        foreach ([['words' => 1000, 'seconds' => 7200], ['words' => 500, 'seconds' => 3600]] as $spec) {
            $project = $this->makeProject(['total_words' => $spec['words'], 'total_pages' => 2]);
            Assignment::create([
                'project_id' => $project->id,
                'translator_id' => $this->translator->id,
                'status' => Assignment::STATUS_DELIVERED,
                'claimed_at' => now()->subDays(2),
                'delivered_at' => now()->subDay(),
                'work_seconds' => $spec['seconds'],
            ]);
        }

        $data = $this->actingAs($this->pm, 'sanctum')
            ->getJson('/api/v1/reports/translators?from='.now()->subWeek()->toDateString().'&to='.now()->toDateString())
            ->assertOk()
            ->json('data');

        $row = collect($data['rows'])->firstWhere('translator', 'سارة المترجمة');
        $this->assertSame(2, $row['files']);
        $this->assertSame(1500, $row['words']);
        $this->assertSame(4, $row['pages']);
        $this->assertEquals(3.0, $row['hours']);
    }

    public function test_pms_report_computes_on_time_and_revision_rates(): void
    {
        // On-time completion (completed before deadline), no revisions.
        $onTime = $this->makeProject(['completed_at' => now()->subDay(), 'deadline_at' => now()->addDay()]);
        $onTime->transitions()->create(['from_status' => 'claimed', 'to_status' => 'delivered', 'actor_id' => $this->translator->id]);

        // Late completion with a revision loop.
        $late = $this->makeProject(['completed_at' => now(), 'deadline_at' => now()->subDays(2)]);
        $late->transitions()->create(['from_status' => 'claimed', 'to_status' => 'delivered', 'actor_id' => $this->translator->id]);
        $late->transitions()->create(['from_status' => 'in_review', 'to_status' => 'revision_requested', 'actor_id' => $this->pm->id]);

        $data = $this->actingAs($this->pm, 'sanctum')
            ->getJson('/api/v1/reports/pms')
            ->assertOk()
            ->json('data');

        $row = collect($data['rows'])->firstWhere('pm', 'منى المديرة');
        $this->assertSame(2, $row['projects']);
        $this->assertSame(2, $row['completed']);
        $this->assertSame(50.0, (float) $row['on_time_pct']);
        $this->assertSame(50.0, (float) $row['revision_pct']);
    }

    public function test_monthly_report_buckets_by_month(): void
    {
        $this->makeProject(['completed_at' => now(), 'total_words' => 800, 'quoted_amount' => 1500]);
        $this->makeProject(['completed_at' => now(), 'total_words' => 200, 'quoted_amount' => 500]);

        $data = $this->actingAs($this->pm, 'sanctum')
            ->getJson('/api/v1/reports/monthly?from='.now()->startOfMonth()->toDateString().'&to='.now()->toDateString())
            ->assertOk()
            ->json('data');

        $month = collect($data['rows'])->firstWhere('month', now()->isoFormat('YYYY/MM'));
        $this->assertSame(2, $month['completed']);
        $this->assertSame(1000, $month['words']);
        $this->assertEquals(2000, $month['amount']);
    }

    public function test_projects_registry_filters_by_status(): void
    {
        $client = Client::create(['name' => 'عميل التقارير', 'type' => 'company', 'created_by' => $this->pm->id]);
        $this->makeProject(['status' => Project::STATUS_AVAILABLE, 'client_id' => $client->id]);
        $this->makeProject(['status' => Project::STATUS_COMPLETED, 'completed_at' => now()]);

        $data = $this->actingAs($this->pm, 'sanctum')
            ->getJson('/api/v1/reports/projects?status=available')
            ->assertOk()
            ->json('data');

        $this->assertCount(1, $data['rows']);
        $this->assertSame('عميل التقارير', $data['rows'][0]['client']);
    }

    public function test_xlsx_export_generates_file_and_notifies(): void
    {
        Notification::fake();
        $this->makeProject(['completed_at' => now(), 'total_words' => 100]);

        $response = $this->actingAs($this->pm, 'sanctum')->postJson('/api/v1/reports/export', [
            'report_type' => 'monthly',
            'format' => 'xlsx',
            'params' => ['from' => now()->startOfMonth()->toDateString(), 'to' => now()->toDateString()],
        ]);

        $response->assertStatus(202);
        $exportId = $response->json('data.id');

        // Sync queue in tests: the job already ran.
        $export = ReportExport::findOrFail($exportId);
        $this->assertSame(ReportExport::STATUS_DONE, $export->status);
        Storage::disk('local')->assertExists($export->disk_path);
        Notification::assertSentTo($this->pm, ReportReadyNotification::class);

        // Owner can download; another user cannot.
        $this->actingAs($this->pm, 'sanctum')
            ->get("/api/v1/reports/exports/{$exportId}/download")
            ->assertOk();

        $other = User::factory()->create();
        $other->syncRoles(['project_manager']);
        $this->actingAs($other, 'sanctum')
            ->get("/api/v1/reports/exports/{$exportId}/download")
            ->assertForbidden();
    }

    public function test_pdf_export_posts_html_to_gotenberg(): void
    {
        Notification::fake();
        Http::fake([
            '*/forms/chromium/convert/html' => Http::response('%PDF-1.7 fake', 200),
        ]);

        $this->makeProject(['completed_at' => now()]);

        $response = $this->actingAs($this->pm, 'sanctum')->postJson('/api/v1/reports/export', [
            'report_type' => 'translators',
            'format' => 'pdf',
        ]);

        $response->assertStatus(202);
        $export = ReportExport::findOrFail($response->json('data.id'));
        $this->assertSame(ReportExport::STATUS_DONE, $export->status);
        $this->assertStringEndsWith('.pdf', $export->disk_path);
        Storage::disk('local')->assertExists($export->disk_path);

        Http::assertSent(fn ($request) => str_contains($request->url(), '/forms/chromium/convert/html'));
    }

    public function test_exports_list_shows_only_own_exports(): void
    {
        $mine = ReportExport::create([
            'user_id' => $this->pm->id, 'report_type' => 'monthly', 'format' => 'xlsx',
            'params' => [], 'status' => ReportExport::STATUS_DONE, 'disk_path' => 'reports/x.xlsx',
        ]);
        $other = User::factory()->create();
        ReportExport::create([
            'user_id' => $other->id, 'report_type' => 'monthly', 'format' => 'pdf',
            'params' => [], 'status' => ReportExport::STATUS_QUEUED,
        ]);

        $list = $this->actingAs($this->pm, 'sanctum')->getJson('/api/v1/reports/exports')->assertOk()->json('data');

        $this->assertCount(1, $list);
        $this->assertSame($mine->id, $list[0]['id']);
    }

    public function test_translator_cannot_access_reports(): void
    {
        $this->actingAs($this->translator, 'sanctum')->getJson('/api/v1/reports/monthly')->assertForbidden();
        $this->actingAs($this->translator, 'sanctum')->postJson('/api/v1/reports/export', [
            'report_type' => 'monthly', 'format' => 'xlsx',
        ])->assertForbidden();
    }
}
