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

class SearchAndSortingTest extends TestCase
{
    use RefreshDatabase;

    private User $pm;

    private User $admin;

    private Client $client;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->seed(LanguageSeeder::class);

        $this->pm = User::factory()->create();
        $this->pm->syncRoles(['project_manager']);

        // The PM role has no users.view — user sorting is an admin surface.
        $this->admin = User::factory()->create();
        $this->admin->syncRoles(['admin']);

        $this->client = Client::create([
            'name' => 'مؤسسة الأمانة الدولية',
            'type' => 'company',
            'created_by' => $this->pm->id,
        ]);
    }

    private function makeProject(array $overrides = []): Project
    {
        $en = Language::where('code', 'en')->firstOrFail();
        $ar = Language::where('code', 'ar')->firstOrFail();

        return Project::create(array_merge([
            'code' => 'BM-2026-'.str_pad((string) random_int(1, 99999), 5, '0', STR_PAD_LEFT),
            'title' => 'مشروع بحث',
            'source_language_id' => $en->id,
            'target_language_id' => $ar->id,
            'service_type' => 'certified',
            'priority' => 'normal',
            'status' => Project::STATUS_DRAFT,
            'deadline_at' => now()->addDays(2),
            'created_by' => $this->pm->id,
        ], $overrides));
    }

    public function test_project_search_matches_client_name_via_scout(): void
    {
        $this->makeProject(['title' => 'عقد توريد', 'client_id' => $this->client->id]);
        $this->makeProject(['title' => 'ملف آخر بلا عميل']);

        $data = $this->actingAs($this->pm, 'sanctum')
            ->getJson('/api/v1/projects?q='.rawurlencode('الأمانة'))
            ->assertOk()
            ->json('data');

        // The old ilike search only covered title/code — matching by client
        // name proves the Scout document (incl. client) is what's searched.
        $this->assertCount(1, $data);
        $this->assertSame('عقد توريد', $data[0]['title']);
    }

    public function test_client_search_matches_notes(): void
    {
        Client::create([
            'name' => 'عميل عادي',
            'type' => 'individual',
            'notes' => 'يفضل التواصل عبر واتساب',
            'created_by' => $this->pm->id,
        ]);

        $data = $this->actingAs($this->pm, 'sanctum')
            ->getJson('/api/v1/clients?q='.rawurlencode('واتساب'))
            ->assertOk()
            ->json('data');

        $this->assertCount(1, $data);
        $this->assertSame('عميل عادي', $data[0]['name']);
    }

    public function test_projects_sort_server_side(): void
    {
        $this->makeProject(['title' => 'بعيد', 'deadline_at' => now()->addDays(9)]);
        $this->makeProject(['title' => 'قريب', 'deadline_at' => now()->addDay()]);
        $this->makeProject(['title' => 'متوسط', 'deadline_at' => now()->addDays(5)]);

        $titles = collect(
            $this->actingAs($this->pm, 'sanctum')
                ->getJson('/api/v1/projects?sort=deadline_at&dir=asc')
                ->assertOk()
                ->json('data'),
        )->pluck('title')->all();

        $this->assertSame(['قريب', 'متوسط', 'بعيد'], $titles);
    }

    public function test_clients_sort_server_side_including_project_counts(): void
    {
        $busy = Client::create(['name' => 'ألف', 'type' => 'company', 'created_by' => $this->pm->id]);
        Client::create(['name' => 'ياء', 'type' => 'individual', 'created_by' => $this->pm->id]);
        $this->makeProject(['client_id' => $busy->id]);
        $this->makeProject(['client_id' => $busy->id]);

        $names = fn (string $query) => collect(
            $this->actingAs($this->pm, 'sanctum')->getJson("/api/v1/clients?{$query}")->assertOk()->json('data'),
        )->pluck('name')->all();

        $this->assertSame('ألف', $names('sort=name&dir=asc')[0]);
        $this->assertSame('ياء', $names('sort=name&dir=desc')[0]);
        // Counting projects proves the sort reaches past the current page's rows.
        $this->assertSame('ألف', $names('sort=projects_count&dir=desc')[0]);
    }

    public function test_users_sort_server_side(): void
    {
        User::factory()->create(['name' => 'أحمد', 'last_login_at' => now()->subDays(5)]);
        User::factory()->create(['name' => 'زياد', 'last_login_at' => now()->subDay()]);

        $names = fn (string $query) => collect(
            $this->actingAs($this->admin, 'sanctum')->getJson("/api/v1/users?{$query}")->assertOk()->json('data'),
        )->pluck('name')->all();

        // Relative order only — the seeded PM/admin carry factory-random names.
        $byName = $names('sort=name&dir=asc');
        $this->assertLessThan(array_search('زياد', $byName), array_search('أحمد', $byName));

        $byLogin = $names('sort=last_login_at&dir=desc');
        $this->assertLessThan(array_search('أحمد', $byLogin), array_search('زياد', $byLogin));
    }

    public function test_unknown_sort_column_falls_back_safely(): void
    {
        $this->makeProject();
        Client::create(['name' => 'عميل', 'type' => 'individual', 'created_by' => $this->pm->id]);

        foreach (['projects', 'clients', 'users'] as $resource) {
            $this->actingAs($this->admin, 'sanctum')
                ->getJson("/api/v1/{$resource}?sort=evil_column;drop--&dir=asc")
                ->assertOk();
        }
    }
}
