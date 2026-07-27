<?php

namespace Tests\Feature;

use App\Models\Language;
use App\Models\User;
use Database\Seeders\LanguageSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class UserManagementTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->seed(LanguageSeeder::class);

        $this->admin = User::factory()->create();
        $this->admin->syncRoles(['admin']);
    }

    public function test_admin_can_create_user_with_role(): void
    {
        $response = $this->actingAs($this->admin, 'sanctum')->postJson('/api/v1/users', [
            'name' => 'مترجم جديد',
            'email' => 'new-translator@test.local',
            'password' => 'secret123',
            'role' => 'translator',
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.roles.0', 'translator')
            ->assertJsonPath('data.status', 'active');
    }

    public function test_translator_cannot_access_user_management(): void
    {
        $translator = User::factory()->create();
        $translator->syncRoles(['translator']);

        $this->actingAs($translator, 'sanctum')->getJson('/api/v1/users')->assertForbidden();
        $this->actingAs($translator, 'sanctum')->postJson('/api/v1/users', [])->assertForbidden();
    }

    public function test_project_manager_cannot_manage_users(): void
    {
        $pm = User::factory()->create();
        $pm->syncRoles(['project_manager']);

        $this->actingAs($pm, 'sanctum')->getJson('/api/v1/users')->assertForbidden();
    }

    public function test_duplicate_email_is_rejected(): void
    {
        User::factory()->create(['email' => 'dup@test.local']);

        $this->actingAs($this->admin, 'sanctum')->postJson('/api/v1/users', [
            'name' => 'Someone',
            'email' => 'dup@test.local',
            'password' => 'secret123',
            'role' => 'translator',
        ])->assertUnprocessable()->assertJsonValidationErrors('email');
    }

    public function test_suspension_revokes_tokens_immediately(): void
    {
        $translator = User::factory()->create();
        $translator->syncRoles(['translator']);
        $token = $translator->createToken('spa')->plainTextToken;

        // Token works before suspension
        $this->withToken($token)->getJson('/api/v1/auth/me')->assertOk();

        $this->actingAs($this->admin, 'sanctum')
            ->putJson("/api/v1/users/{$translator->id}/status", ['status' => 'suspended'])
            ->assertOk()
            ->assertJsonPath('data.status', 'suspended');

        $this->assertSame(0, $translator->tokens()->count());
    }

    public function test_admin_cannot_suspend_self(): void
    {
        $this->actingAs($this->admin, 'sanctum')
            ->putJson("/api/v1/users/{$this->admin->id}/status", ['status' => 'suspended'])
            ->assertStatus(422);
    }

    public function test_admin_cannot_delete_self(): void
    {
        $this->actingAs($this->admin, 'sanctum')
            ->deleteJson("/api/v1/users/{$this->admin->id}")
            ->assertStatus(422);
    }

    public function test_language_pairs_sync_for_translator(): void
    {
        $translator = User::factory()->create();
        $translator->syncRoles(['translator']);

        $ar = Language::where('code', 'ar')->first();
        $en = Language::where('code', 'en')->first();

        $this->actingAs($this->admin, 'sanctum')
            ->putJson("/api/v1/users/{$translator->id}/language-pairs", [
                'pairs' => [
                    ['source_language_id' => $en->id, 'target_language_id' => $ar->id],
                    ['source_language_id' => $ar->id, 'target_language_id' => $en->id],
                ],
            ])
            ->assertOk()
            ->assertJsonCount(2, 'data');
    }

    public function test_language_pair_with_same_source_and_target_is_rejected(): void
    {
        $translator = User::factory()->create();
        $translator->syncRoles(['translator']);

        $ar = Language::where('code', 'ar')->first();

        $this->actingAs($this->admin, 'sanctum')
            ->putJson("/api/v1/users/{$translator->id}/language-pairs", [
                'pairs' => [
                    ['source_language_id' => $ar->id, 'target_language_id' => $ar->id],
                ],
            ])
            ->assertUnprocessable();
    }

    public function test_language_pairs_rejected_for_non_translator(): void
    {
        $pm = User::factory()->create();
        $pm->syncRoles(['project_manager']);

        $ar = Language::where('code', 'ar')->first();
        $en = Language::where('code', 'en')->first();

        $this->actingAs($this->admin, 'sanctum')
            ->putJson("/api/v1/users/{$pm->id}/language-pairs", [
                'pairs' => [
                    ['source_language_id' => $en->id, 'target_language_id' => $ar->id],
                ],
            ])
            ->assertStatus(422);
    }

    public function test_users_list_supports_search_and_role_filter(): void
    {
        $t = User::factory()->create(['name' => 'سارة المترجمة']);
        $t->syncRoles(['translator']);

        $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/v1/users?q=سارة')
            ->assertOk()
            ->assertJsonCount(1, 'data');

        $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/v1/users?role=translator')
            ->assertOk()
            ->assertJsonCount(1, 'data');
    }
}
