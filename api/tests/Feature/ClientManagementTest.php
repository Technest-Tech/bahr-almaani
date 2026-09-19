<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Invoice;
use App\Models\Language;
use App\Models\Project;
use App\Models\User;
use Database\Seeders\LanguageSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ClientManagementTest extends TestCase
{
    use RefreshDatabase;

    private User $pm;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);

        $this->pm = User::factory()->create();
        $this->pm->syncRoles(['project_manager']);
    }

    public function test_pm_can_create_and_list_clients(): void
    {
        $this->actingAs($this->pm, 'sanctum')->postJson('/api/v1/clients', [
            'name' => 'شركة النور للاستيراد',
            'type' => 'company',
            'phone' => '01000000000',
        ])->assertCreated()->assertJsonPath('data.name', 'شركة النور للاستيراد');

        // Percent-encode like real clients do — raw multibyte in test URLs corrupts specific UTF-8 bytes.
        $this->actingAs($this->pm, 'sanctum')
            ->getJson('/api/v1/clients?q='.rawurlencode('النور'))
            ->assertOk()
            ->assertJsonCount(1, 'data');
    }

    public function test_translator_cannot_access_clients(): void
    {
        $translator = User::factory()->create();
        $translator->syncRoles(['translator']);

        $this->actingAs($translator, 'sanctum')->getJson('/api/v1/clients')->assertForbidden();
    }

    public function test_client_with_projects_cannot_be_deleted(): void
    {
        $this->seed(LanguageSeeder::class);
        $client = Client::create(['name' => 'عميل', 'type' => 'individual', 'created_by' => $this->pm->id]);

        Project::create([
            'code' => 'BM-2026-99999',
            'client_id' => $client->id,
            'title' => 'مشروع',
            'source_language_id' => Language::where('code', 'en')->first()->id,
            'target_language_id' => Language::where('code', 'ar')->first()->id,
            'service_type' => 'certified',
            'priority' => 'normal',
            'status' => Project::STATUS_DRAFT,
            'deadline_at' => now()->addDay(),
            'created_by' => $this->pm->id,
        ]);

        $this->actingAs($this->pm, 'sanctum')
            ->deleteJson("/api/v1/clients/{$client->id}")
            ->assertStatus(422);
    }

    public function test_the_client_file_lists_every_invoice_and_project_not_just_the_latest_ten(): void
    {
        $this->seed(LanguageSeeder::class);
        $client = Client::create(['name' => 'عميل قديم', 'type' => 'company', 'created_by' => $this->pm->id]);

        foreach (range(1, 12) as $n) {
            $project = Project::create([
                'code' => 'BM-2026-'.str_pad((string) $n, 5, '0', STR_PAD_LEFT),
                'client_id' => $client->id,
                'title' => "مشروع {$n}",
                'source_language_id' => Language::where('code', 'en')->first()->id,
                'target_language_id' => Language::where('code', 'ar')->first()->id,
                'service_type' => 'certified',
                'priority' => 'normal',
                'status' => Project::STATUS_COMPLETED,
                'deadline_at' => now()->addDay(),
                'created_by' => $this->pm->id,
            ]);

            Invoice::create([
                'number' => 'INV-2026-'.str_pad((string) $n, 5, '0', STR_PAD_LEFT),
                'client_id' => $client->id,
                'total_pages' => 1,
                'amount' => 100,
                'line_items' => [['project_id' => $project->id, 'code' => $project->code, 'title' => $project->title, 'pages' => 1, 'words' => null]],
                'created_by' => $this->pm->id,
                'issued_at' => now()->subDays($n),
            ]);
        }

        $overview = $this->actingAs($this->pm, 'sanctum')
            ->getJson("/api/v1/clients/{$client->id}/overview")
            ->assertOk();

        $this->assertCount(12, $overview->json('projects'));
        $this->assertCount(12, $overview->json('invoices'));
        // The oldest invoice is there, with the file it bills.
        $this->assertSame('INV-2026-00012', $overview->json('invoices.11.number'));
        $this->assertSame('مشروع 12', $overview->json('invoices.11.line_items.0.title'));
    }
}
