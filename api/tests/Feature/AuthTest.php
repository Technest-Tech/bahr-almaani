<?php

namespace Tests\Feature;

use App\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
    }

    private function makeAdmin(): User
    {
        $admin = User::factory()->create(['email' => 'admin@test.local']);
        $admin->syncRoles(['admin']);

        return $admin;
    }

    public function test_login_returns_token_and_user(): void
    {
        $this->makeAdmin();

        $response = $this->postJson('/api/v1/auth/login', [
            'email' => 'admin@test.local',
            'password' => 'password',
        ]);

        $response->assertOk()
            ->assertJsonStructure(['token', 'user' => ['id', 'name', 'email', 'roles']])
            ->assertJsonPath('user.roles.0', 'admin');
    }

    public function test_login_fails_with_wrong_password(): void
    {
        $this->makeAdmin();

        $this->postJson('/api/v1/auth/login', [
            'email' => 'admin@test.local',
            'password' => 'wrong-password',
        ])->assertUnprocessable()->assertJsonValidationErrors('email');
    }

    public function test_suspended_user_cannot_login(): void
    {
        $user = User::factory()->create(['status' => User::STATUS_SUSPENDED]);
        $user->syncRoles(['translator']);

        $this->postJson('/api/v1/auth/login', [
            'email' => $user->email,
            'password' => 'password',
        ])->assertUnprocessable()->assertJsonValidationErrors('email');
    }

    public function test_me_returns_user_with_permissions(): void
    {
        $admin = $this->makeAdmin();

        $this->actingAs($admin, 'sanctum')
            ->getJson('/api/v1/auth/me')
            ->assertOk()
            ->assertJsonStructure(['user', 'permissions'])
            ->assertJsonFragment(['users.manage']);
    }

    public function test_logout_revokes_current_token(): void
    {
        $admin = $this->makeAdmin();
        $token = $admin->createToken('spa')->plainTextToken;

        $this->withToken($token)->postJson('/api/v1/auth/logout')->assertOk();

        $this->assertSame(0, $admin->tokens()->count());
    }

    public function test_unauthenticated_requests_are_rejected(): void
    {
        $this->getJson('/api/v1/auth/me')->assertUnauthorized();
        $this->getJson('/api/v1/users')->assertUnauthorized();
    }
}
