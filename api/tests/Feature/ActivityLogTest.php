<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ActivityLogTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $pm;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);

        $this->admin = User::factory()->create();
        $this->admin->syncRoles(['admin']);

        $this->pm = User::factory()->create(['name' => 'منى المديرة']);
        $this->pm->syncRoles(['project_manager']);
    }

    public function test_admin_sees_activity_with_causer_and_subject_labels(): void
    {
        // A PM creating a client produces a "clients" log entry with the PM as causer.
        $response = $this->actingAs($this->pm, 'sanctum')->postJson('/api/v1/clients', [
            'name' => 'شركة الفجر للتجارة',
            'type' => 'company',
            'phone' => '01000000000',
        ]);
        $response->assertCreated();

        $list = $this->actingAs($this->admin, 'sanctum')->getJson('/api/v1/activity-log');

        $list->assertOk();
        $row = collect($list->json('data'))->firstWhere('log_name', 'clients');
        $this->assertNotNull($row);
        $this->assertSame('created', $row['event']);
        $this->assertSame('منى المديرة', $row['causer']['name']);
        $this->assertSame('شركة الفجر للتجارة', $row['subject_label']);
        $this->assertSame('شركة الفجر للتجارة', $row['changes']['attributes']['name'] ?? null);
    }

    public function test_filters_by_log_name_and_causer(): void
    {
        $this->actingAs($this->pm, 'sanctum')
            ->postJson('/api/v1/clients', ['name' => 'عميل أول', 'type' => 'individual'])
            ->assertCreated();

        // Admin updates a user → a "users" log entry with the admin as causer.
        $this->actingAs($this->admin, 'sanctum')
            ->putJson("/api/v1/users/{$this->pm->id}", ['name' => 'منى المعدلة', 'email' => $this->pm->email])
            ->assertOk();

        $byLog = $this->actingAs($this->admin, 'sanctum')->getJson('/api/v1/activity-log?log=clients');
        $this->assertTrue(collect($byLog->json('data'))->every(fn ($r) => $r['log_name'] === 'clients'));

        $byCauser = $this->actingAs($this->admin, 'sanctum')
            ->getJson("/api/v1/activity-log?causer_id={$this->admin->id}");
        $this->assertTrue(
            collect($byCauser->json('data'))->every(fn ($r) => $r['causer']['id'] === $this->admin->id),
        );
        $this->assertNotEmpty($byCauser->json('data'));
    }

    public function test_deleted_subject_still_shows_its_label(): void
    {
        $this->actingAs($this->pm, 'sanctum')
            ->postJson('/api/v1/clients', ['name' => 'عميل سيُحذف', 'type' => 'individual'])
            ->assertCreated();

        $client = Client::where('name', 'عميل سيُحذف')->firstOrFail();
        $this->actingAs($this->pm, 'sanctum')->deleteJson("/api/v1/clients/{$client->id}");

        $rows = collect(
            $this->actingAs($this->admin, 'sanctum')->getJson('/api/v1/activity-log?log=clients')->json('data'),
        );

        $this->assertTrue($rows->every(fn ($r) => $r['subject_label'] === 'عميل سيُحذف'));
    }

    public function test_non_admin_is_denied(): void
    {
        $this->actingAs($this->pm, 'sanctum')->getJson('/api/v1/activity-log')->assertForbidden();
    }
}
