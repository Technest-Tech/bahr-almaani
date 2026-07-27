<?php

namespace Tests\Feature;

use App\Models\Client;
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
}
