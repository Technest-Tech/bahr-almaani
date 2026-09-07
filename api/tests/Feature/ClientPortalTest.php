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

/**
 * M15 — client accounts and the client area of the website.
 *
 * The load-bearing property here is the guard split: the client area and the
 * operations app authenticate against different tables, and neither side's token
 * may cross into the other.
 */
class ClientPortalTest extends TestCase
{
    use RefreshDatabase;

    private User $pm;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->seed(LanguageSeeder::class);

        $this->pm = User::factory()->create();
        $this->pm->syncRoles(['project_manager']);
    }

    private function client(array $attributes = []): Client
    {
        return Client::create([
            'name' => 'شركة النور',
            'type' => 'company',
            'email' => 'noor@example.com',
            'created_by' => $this->pm->id,
            ...$attributes,
        ]);
    }

    /**
     * `delivered_*` is guarded on the model — the counting service writes it, never
     * a request — so the test forces it the same way production does.
     */
    private function project(Client $client, array $attributes = []): Project
    {
        $guarded = array_intersect_key(
            $attributes,
            array_flip(['delivered_pages', 'delivered_words', 'delivered_chars', 'completed_at']),
        );

        $project = Project::create([
            'code' => 'BM-2026-'.str_pad((string) random_int(1, 99999), 5, '0', STR_PAD_LEFT),
            'client_id' => $client->id,
            'title' => 'عقد إيجار',
            'source_language_id' => Language::where('code', 'en')->first()->id,
            'target_language_id' => Language::where('code', 'ar')->first()->id,
            'service_type' => 'certified',
            'priority' => 'normal',
            'status' => Project::STATUS_CLAIMED,
            'deadline_at' => now()->addDay(),
            'created_by' => $this->pm->id,
            ...array_diff_key($attributes, $guarded),
        ]);

        if ($guarded !== []) {
            $project->forceFill($guarded)->save();
        }

        return $project;
    }

    public function test_visitor_can_register_and_is_signed_in(): void
    {
        $response = $this->postJson('/api/v1/client/auth/register', [
            'name' => 'أحمد عمر',
            'type' => 'individual',
            'phone' => '01000000000',
            'email' => 'Ahmed@Example.COM',
            'password' => 'secret-passphrase',
            'password_confirmation' => 'secret-passphrase',
        ])->assertCreated();

        $this->assertNotEmpty($response->json('token'));

        $client = Client::withAccount()->firstOrFail();
        // The address is the login identity, so it is folded on the way in.
        $this->assertSame('ahmed@example.com', $client->email);
        $this->assertTrue($client->self_registered);
        $this->assertNull($client->created_by);
    }

    public function test_registration_is_refused_when_the_office_already_has_the_email(): void
    {
        $this->client(['email' => 'noor@example.com']);

        $this->postJson('/api/v1/client/auth/register', [
            'name' => 'شخص آخر',
            'type' => 'individual',
            'email' => 'NOOR@example.com',
            'password' => 'secret-passphrase',
            'password_confirmation' => 'secret-passphrase',
        ])->assertStatus(422)->assertJsonValidationErrors('email');

        $this->assertSame(1, Client::count());
    }

    public function test_a_row_without_a_password_cannot_be_signed_in_as(): void
    {
        $this->client();

        $this->postJson('/api/v1/client/auth/login', [
            'email' => 'noor@example.com',
            'password' => 'anything-at-all',
        ])->assertStatus(422);
    }

    public function test_the_office_can_open_an_account_for_an_existing_client(): void
    {
        $client = $this->client();

        $this->actingAs($this->pm, 'sanctum')
            ->putJson("/api/v1/clients/{$client->id}", [
                'name' => $client->name,
                'type' => $client->type,
                'email' => $client->email,
                'password' => 'office-issued-pass',
                'password_confirmation' => 'office-issued-pass',
            ])
            ->assertOk()
            ->assertJsonPath('data.has_account', true);

        $this->postJson('/api/v1/client/auth/login', [
            'email' => 'noor@example.com',
            'password' => 'office-issued-pass',
        ])->assertOk()->assertJsonPath('client.name', 'شركة النور');

        $this->assertNotNull($client->fresh()->last_login_at);
    }

    public function test_the_password_is_never_serialised(): void
    {
        $client = $this->client(['password' => 'office-issued-pass']);

        $body = $this->actingAs($this->pm, 'sanctum')
            ->getJson("/api/v1/clients/{$client->id}")
            ->assertOk()
            ->json('data');

        $this->assertArrayNotHasKey('password', $body);
        $this->assertTrue($body['has_account']);
    }

    public function test_a_client_token_cannot_reach_the_operations_app(): void
    {
        $this->client(['password' => 'office-issued-pass']);

        $token = $this->postJson('/api/v1/client/auth/login', [
            'email' => 'noor@example.com',
            'password' => 'office-issued-pass',
        ])->json('token');

        $this->withToken($token)->getJson('/api/v1/clients')->assertUnauthorized();
        $this->withToken($token)->getJson('/api/v1/projects')->assertUnauthorized();
        $this->withToken($token)->getJson('/api/v1/auth/me')->assertUnauthorized();
    }

    public function test_a_staff_token_cannot_reach_the_client_area(): void
    {
        $token = $this->pm->createToken('spa')->plainTextToken;

        $this->withToken($token)->getJson('/api/v1/client/overview')->assertUnauthorized();
    }

    public function test_a_client_sees_their_own_history_and_page_counts(): void
    {
        $client = $this->client(['password' => 'office-issued-pass']);

        $this->project($client, [
            'status' => Project::STATUS_COMPLETED,
            'completed_at' => now(),
            'delivered_pages' => 12,
            'delivered_words' => 3400,
        ]);
        $this->project($client, ['status' => Project::STATUS_CLAIMED, 'total_pages' => 3]);
        // Still being assembled by the office — internal until published.
        $this->project($client, ['status' => Project::STATUS_DRAFT, 'total_pages' => 99]);

        $overview = $this->actingAs($client, 'client')
            ->getJson('/api/v1/client/overview')
            ->assertOk()
            ->json();

        $this->assertSame(2, $overview['stats']['projects_total']);
        $this->assertSame(15, $overview['stats']['total_pages']);
        $this->assertSame(1, $overview['stats']['by_stage']['completed']);
        $this->assertSame(1, $overview['stats']['by_stage']['in_progress']);
        $this->assertCount(2, $overview['recent_projects']);
        // Office-only field: the client must never read the notes kept about them.
        $this->assertArrayNotHasKey('notes', $overview['client']);

        $this->actingAs($client, 'client')
            ->getJson('/api/v1/client/projects')
            ->assertOk()
            ->assertJsonCount(2, 'data');
    }

    public function test_a_client_cannot_open_another_clients_project(): void
    {
        $mine = $this->client(['password' => 'office-issued-pass']);
        $theirs = $this->client(['email' => 'other@example.com']);

        $hidden = $this->project($theirs);
        $draft = $this->project($mine, ['status' => Project::STATUS_DRAFT]);

        $this->actingAs($mine, 'client')
            ->getJson("/api/v1/client/projects/{$hidden->id}")
            ->assertNotFound();

        $this->actingAs($mine, 'client')
            ->getJson("/api/v1/client/projects/{$draft->id}")
            ->assertNotFound();
    }

    public function test_the_internal_pipeline_is_not_exposed_to_the_client(): void
    {
        $client = $this->client(['password' => 'office-issued-pass']);
        $project = $this->project($client, ['status' => Project::STATUS_REVISION_REQUESTED]);

        $body = $this->actingAs($client, 'client')
            ->getJson("/api/v1/client/projects/{$project->id}")
            ->assertOk()
            ->json('data');

        $this->assertSame('in_review', $body['stage']);
        $this->assertArrayNotHasKey('status', $body);
        $this->assertArrayNotHasKey('assignment', $body);
    }

    public function test_suspending_a_client_ends_the_session_and_blocks_the_next_login(): void
    {
        $client = $this->client(['password' => 'office-issued-pass']);

        $token = $this->postJson('/api/v1/client/auth/login', [
            'email' => 'noor@example.com',
            'password' => 'office-issued-pass',
        ])->json('token');

        $this->actingAs($this->pm, 'sanctum')->putJson("/api/v1/clients/{$client->id}", [
            'name' => $client->name,
            'type' => $client->type,
            'email' => $client->email,
            'status' => Client::STATUS_SUSPENDED,
        ])->assertOk();

        $this->withToken($token)->getJson('/api/v1/client/overview')->assertUnauthorized();

        $this->postJson('/api/v1/client/auth/login', [
            'email' => 'noor@example.com',
            'password' => 'office-issued-pass',
        ])->assertStatus(422);
    }

    public function test_admin_sees_the_client_file(): void
    {
        $client = $this->client(['password' => 'office-issued-pass']);
        $this->project($client, [
            'status' => Project::STATUS_COMPLETED,
            'completed_at' => now(),
            'delivered_pages' => 7,
        ]);

        $body = $this->actingAs($this->pm, 'sanctum')
            ->getJson("/api/v1/clients/{$client->id}/overview")
            ->assertOk()
            ->json();

        $this->assertSame(7, $body['stats']['total_pages']);
        $this->assertSame(1, $body['stats']['uninvoiced_projects']);
        $this->assertTrue($body['client']['has_account']);
        $this->assertCount(1, $body['projects']);
        $this->assertMatchesRegularExpression(
            '/^\d{4}-\d{2}-\d{2}T/',
            $body['stats']['last_delivery_at'],
        );
    }

    public function test_revoking_the_account_keeps_the_client_and_their_history(): void
    {
        $client = $this->client(['password' => 'office-issued-pass']);
        $this->project($client);

        $this->actingAs($this->pm, 'sanctum')
            ->deleteJson("/api/v1/clients/{$client->id}/account")
            ->assertOk()
            ->assertJsonPath('data.has_account', false);

        $this->assertDatabaseHas('clients', ['id' => $client->id, 'password' => null]);
        $this->assertSame(1, $client->projects()->count());
    }

    public function test_a_client_can_change_their_own_password(): void
    {
        $this->client(['password' => 'office-issued-pass']);

        $token = $this->postJson('/api/v1/client/auth/login', [
            'email' => 'noor@example.com',
            'password' => 'office-issued-pass',
        ])->json('token');

        $this->withToken($token)->putJson('/api/v1/client/auth/me/password', [
            'current_password' => 'wrong-one',
            'password' => 'a-new-passphrase',
            'password_confirmation' => 'a-new-passphrase',
        ])->assertStatus(422);

        $this->withToken($token)->putJson('/api/v1/client/auth/me/password', [
            'current_password' => 'office-issued-pass',
            'password' => 'a-new-passphrase',
            'password_confirmation' => 'a-new-passphrase',
        ])->assertOk();

        $this->postJson('/api/v1/client/auth/login', [
            'email' => 'noor@example.com',
            'password' => 'a-new-passphrase',
        ])->assertOk();
    }
}
