<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Invoice;
use App\Models\Language;
use App\Models\Project;
use App\Models\ProjectFile;
use App\Models\User;
use Database\Seeders\LanguageSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Each PM sees their own projects; the admin sees everyone's (client request
 * 2026-09-19). Every PM used to scroll through the whole office's list to find
 * their own files. The owner is `created_by`, which already decides who hears
 * about a delivery and a deadline.
 */
class ProjectOwnershipTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $accountant;

    private User $mona;

    private User $karim;

    private Client $client;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->seed(LanguageSeeder::class);
        Storage::fake('local');

        $this->admin = User::factory()->create();
        $this->admin->syncRoles(['admin']);

        $this->accountant = User::factory()->create();
        $this->accountant->syncRoles(['accountant']);

        $this->mona = User::factory()->create(['name' => 'منى']);
        $this->mona->syncRoles(['project_manager']);

        $this->karim = User::factory()->create(['name' => 'كريم']);
        $this->karim->syncRoles(['project_manager']);

        $this->client = Client::create([
            'name' => 'شركة النيل',
            'type' => 'company',
            'created_by' => $this->admin->id,
        ]);
    }

    private function makeProject(?User $owner, array $overrides = []): Project
    {
        return Project::create(array_merge([
            'code' => 'BM-2026-'.str_pad((string) random_int(1, 99999), 5, '0', STR_PAD_LEFT),
            'title' => 'ترجمة عقد',
            'client_id' => $this->client->id,
            'source_language_id' => Language::where('code', 'en')->firstOrFail()->id,
            'target_language_id' => Language::where('code', 'ar')->firstOrFail()->id,
            'service_type' => 'certified',
            'priority' => 'normal',
            'status' => Project::STATUS_AVAILABLE,
            'deadline_at' => now()->addDays(3),
            'created_by' => $owner?->id,
        ], $overrides));
    }

    private function listedIds(User $user): array
    {
        return collect($this->actingAs($user, 'sanctum')->getJson('/api/v1/projects?per_page=100')
            ->assertOk()
            ->json('data'))->pluck('id')->sort()->values()->all();
    }

    public function test_a_pm_lists_only_their_own_projects_and_the_admin_lists_all(): void
    {
        $monas = $this->makeProject($this->mona);
        $karims = $this->makeProject($this->karim);

        $this->assertSame([$monas->id], $this->listedIds($this->mona));
        $this->assertSame([$karims->id], $this->listedIds($this->karim));
        $this->assertSame([$monas->id, $karims->id], $this->listedIds($this->admin));
    }

    public function test_the_search_box_stays_inside_the_pms_own_projects(): void
    {
        $this->makeProject($this->karim, ['title' => 'عقد إيجار']);
        $monas = $this->makeProject($this->mona, ['title' => 'عقد إيجار']);

        $found = $this->actingAs($this->mona, 'sanctum')
            ->getJson('/api/v1/projects?q='.urlencode('عقد إيجار'))
            ->assertOk()
            ->json('data');

        $this->assertSame([$monas->id], array_column($found, 'id'));
    }

    public function test_a_client_submission_nobody_owns_yet_is_visible_to_every_pm(): void
    {
        $unowned = $this->makeProject(null, ['status' => Project::STATUS_DRAFT]);

        $this->assertSame([$unowned->id], $this->listedIds($this->mona));
        $this->assertSame([$unowned->id], $this->listedIds($this->karim));
        $this->actingAs($this->karim, 'sanctum')->getJson("/api/v1/projects/{$unowned->id}")->assertOk();
    }

    public function test_a_pm_cannot_open_or_act_on_another_pms_project(): void
    {
        $karims = $this->makeProject($this->karim);
        $file = ProjectFile::create([
            'project_id' => $karims->id,
            'category' => ProjectFile::CATEGORY_SOURCE,
            'original_name' => 'contract.pdf',
            'disk_path' => 'projects/contract.pdf',
            'mime_type' => 'application/pdf',
            'size_bytes' => 10,
            'version' => 1,
            'uploaded_by' => $this->karim->id,
        ]);
        Storage::disk('local')->put('projects/contract.pdf', '%PDF-1.4');

        $asMona = $this->actingAs($this->mona, 'sanctum');

        $asMona->getJson("/api/v1/projects/{$karims->id}")
            ->assertForbidden()
            ->assertJsonPath('message', __('projects.not_yours'));
        $asMona->getJson("/api/v1/projects/{$karims->id}/timeline")->assertForbidden();
        $asMona->get("/api/v1/projects/{$karims->id}/files/{$file->id}/download")->assertForbidden();
        $asMona->postJson("/api/v1/projects/{$karims->id}/cancel", ['reason' => 'x'])->assertForbidden();
        $asMona->postJson("/api/v1/projects/{$karims->id}/review/open")->assertForbidden();
        $asMona->deleteJson("/api/v1/projects/{$karims->id}")->assertForbidden();

        $this->assertSame(Project::STATUS_AVAILABLE, $karims->fresh()->status);
        $this->assertNotSoftDeleted($karims);

        // The owner and the admin are unaffected.
        $this->actingAs($this->karim, 'sanctum')->getJson("/api/v1/projects/{$karims->id}")->assertOk();
        $this->actingAs($this->admin, 'sanctum')
            ->get("/api/v1/projects/{$karims->id}/files/{$file->id}/download")
            ->assertOk();
    }

    public function test_the_dashboard_counts_a_pms_own_projects_and_the_admins_counts_all(): void
    {
        $this->makeProject($this->mona, ['deadline_at' => now()->subHour()]);
        $this->makeProject($this->karim, ['deadline_at' => now()->subHour()]);
        $this->makeProject($this->karim);

        $this->actingAs($this->mona, 'sanctum')->getJson('/api/v1/dashboard/summary')
            ->assertOk()
            ->assertJsonPath('data.statuses.available', 1)
            ->assertJsonPath('data.late', 1);

        $this->actingAs($this->karim, 'sanctum')->getJson('/api/v1/dashboard/summary')
            ->assertOk()
            ->assertJsonPath('data.statuses.available', 2);

        // Separate cache entries: the PMs above must not have primed the admin's.
        $this->actingAs($this->admin, 'sanctum')->getJson('/api/v1/dashboard/summary')
            ->assertOk()
            ->assertJsonPath('data.statuses.available', 3)
            ->assertJsonPath('data.late', 2);

        $this->actingAs($this->mona, 'sanctum')->getJson('/api/v1/dashboard/late')
            ->assertOk()
            ->assertJsonCount(1, 'data.late');
    }

    public function test_the_workload_hides_what_a_translator_holds_for_another_pm(): void
    {
        $translator = User::factory()->create(['name' => 'سارة']);
        $translator->syncRoles(['translator']);

        $karims = $this->makeProject($this->karim, ['status' => Project::STATUS_CLAIMED]);
        $karims->assignments()->create([
            'translator_id' => $translator->id,
            'status' => 'active',
            'claimed_at' => now(),
        ]);

        $row = fn (User $viewer) => collect($this->actingAs($viewer, 'sanctum')
            ->getJson('/api/v1/dashboard/workload')->assertOk()->json('data'))
            ->firstWhere('id', $translator->id);

        $this->assertNull($row($this->mona)['current']);
        $this->assertTrue($row($this->mona)['busy_elsewhere']);

        $this->assertSame($karims->id, $row($this->karim)['current']['project_id']);
        $this->assertFalse($row($this->karim)['busy_elsewhere']);
    }

    public function test_the_client_file_shows_a_pm_only_their_own_projects(): void
    {
        $monas = $this->makeProject($this->mona);
        $this->makeProject($this->karim);

        $this->actingAs($this->mona, 'sanctum')->getJson("/api/v1/clients/{$this->client->id}/overview")
            ->assertOk()
            ->assertJsonCount(1, 'projects')
            ->assertJsonPath('projects.0.id', $monas->id)
            ->assertJsonPath('client.projects_count', 1);

        $this->actingAs($this->admin, 'sanctum')->getJson("/api/v1/clients/{$this->client->id}/overview")
            ->assertOk()
            ->assertJsonCount(2, 'projects')
            ->assertJsonPath('client.projects_count', 2);
    }

    public function test_a_pm_bills_their_own_finished_projects_and_the_accountant_bills_anyones(): void
    {
        Http::fake(['*/forms/chromium/convert/html' => Http::response('%PDF-1.7 fake-invoice', 200)]);

        $monas = $this->makeProject($this->mona, ['status' => Project::STATUS_COMPLETED, 'total_pages' => 3]);
        $karims = $this->makeProject($this->karim, ['status' => Project::STATUS_COMPLETED, 'total_pages' => 2]);

        $billable = fn (User $user) => collect($this->actingAs($user, 'sanctum')
            ->getJson("/api/v1/invoices/billable?client_id={$this->client->id}")
            ->assertOk()
            ->json('data'))->pluck('id')->sort()->values()->all();

        $this->assertSame([$monas->id], $billable($this->mona));
        $this->assertSame([$monas->id, $karims->id], $billable($this->accountant));

        // Posting another PM's project id directly is refused as not billable.
        $this->actingAs($this->mona, 'sanctum')->postJson('/api/v1/invoices', [
            'client_id' => $this->client->id,
            'project_ids' => [$karims->id],
            'unit_price' => 100,
        ])->assertStatus(422);
        $this->assertNull($karims->fresh()->invoice_id);
    }

    public function test_a_pm_cannot_edit_an_invoice_that_also_bills_another_pms_work(): void
    {
        Http::fake(['*/forms/chromium/convert/html' => Http::response('%PDF-1.7 fake-invoice', 200)]);

        $monas = $this->makeProject($this->mona, ['status' => Project::STATUS_COMPLETED, 'total_pages' => 3]);
        $karims = $this->makeProject($this->karim, ['status' => Project::STATUS_COMPLETED, 'total_pages' => 2]);

        $invoiceId = $this->actingAs($this->accountant, 'sanctum')->postJson('/api/v1/invoices', [
            'client_id' => $this->client->id,
            'project_ids' => [$monas->id, $karims->id],
            'unit_price' => 100,
        ])->assertSuccessful()->json('data.id');

        // Mona's dialog lists only her project; saving it would unbill Karim's.
        $this->actingAs($this->mona, 'sanctum')->putJson("/api/v1/invoices/{$invoiceId}", [
            'project_ids' => [$monas->id],
            'unit_price' => 120,
        ])->assertForbidden();

        $this->assertSame($invoiceId, $karims->fresh()->invoice_id);
        $this->assertSame(500.0, (float) Invoice::find($invoiceId)->amount);
    }

    public function test_the_admin_sees_and_filters_by_owner_and_translator(): void
    {
        $sara = User::factory()->create(['name' => 'سارة']);
        $sara->syncRoles(['translator']);
        $omar = User::factory()->create(['name' => 'عمر']);
        $omar->syncRoles(['translator']);

        $monas = $this->makeProject($this->mona, ['status' => Project::STATUS_CLAIMED]);
        $monas->assignments()->create(['translator_id' => $omar->id, 'status' => 'withdrawn', 'claimed_at' => now()->subDay()]);
        $monas->assignments()->create(['translator_id' => $sara->id, 'status' => 'active', 'claimed_at' => now()]);
        $karims = $this->makeProject($this->karim);
        // Withdrawn from Omar: back on the portal, no longer his.
        $karims->assignments()->create(['translator_id' => $omar->id, 'status' => 'withdrawn', 'claimed_at' => now()]);
        $unowned = $this->makeProject(null, ['status' => Project::STATUS_DRAFT]);

        $ids = fn (string $query) => collect($this->actingAs($this->admin, 'sanctum')
            ->getJson("/api/v1/projects?{$query}")->assertOk()->json('data'))->pluck('id')->all();

        $this->assertSame([$karims->id], $ids("created_by={$this->karim->id}"));
        $this->assertSame([$unowned->id], $ids('created_by=none'));
        $this->assertSame([$monas->id], $ids("translator_id={$sara->id}"));
        $this->assertSame([], $ids("translator_id={$omar->id}"));

        $row = collect($this->actingAs($this->admin, 'sanctum')->getJson('/api/v1/projects')->json('data'))
            ->firstWhere('id', $monas->id);
        $this->assertSame('منى', $row['creator']['name']);
        $this->assertSame('سارة', $row['assignment']['translator']['name']);

        $options = $this->actingAs($this->admin, 'sanctum')->getJson('/api/v1/projects/filter-options')
            ->assertOk()
            ->json('data');
        $this->assertEqualsCanonicalizing(['منى', 'كريم'], array_column($options['managers'], 'name'));
        $this->assertSame(['سارة'], array_column($options['translators'], 'name'));

        // A PM's list is all their own; the options are the admin's.
        $this->actingAs($this->mona, 'sanctum')->getJson('/api/v1/projects/filter-options')->assertForbidden();
    }

    public function test_view_all_belongs_to_the_admin_and_the_accountant_only(): void
    {
        $this->assertTrue($this->admin->can('projects.view-all'));
        $this->assertTrue($this->accountant->can('projects.view-all'));
        $this->assertFalse($this->mona->can('projects.view-all'));
    }
}
