<?php

namespace Tests\Feature;

use App\Models\Language;
use App\Models\Project;
use App\Models\User;
use Database\Seeders\LanguageSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ProjectLifecycleTest extends TestCase
{
    use RefreshDatabase;

    private User $pm;

    private array $payload;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->seed(LanguageSeeder::class);
        Storage::fake('local');

        $this->pm = User::factory()->create();
        $this->pm->syncRoles(['project_manager']);

        $this->payload = [
            'title' => 'ترجمة عقد تأسيس',
            'source_language_id' => Language::where('code', 'en')->first()->id,
            'target_language_id' => Language::where('code', 'ar')->first()->id,
            'service_type' => 'certified',
            'priority' => 'urgent',
            'deadline_at' => now()->addDays(3)->toIso8601String(),
        ];
    }

    private function createDraft(): Project
    {
        $response = $this->actingAs($this->pm, 'sanctum')
            ->postJson('/api/v1/projects', $this->payload)
            ->assertCreated();

        return Project::find($response->json('data.id'));
    }

    public function test_project_created_as_draft_with_generated_code(): void
    {
        $project = $this->createDraft();

        $this->assertSame(Project::STATUS_DRAFT, $project->status);
        $this->assertMatchesRegularExpression('/^BM-\d{4}-00001$/', $project->code);

        $second = $this->createDraft();
        $this->assertMatchesRegularExpression('/^BM-\d{4}-00002$/', $second->code);
    }

    public function test_same_source_and_target_language_rejected(): void
    {
        $this->actingAs($this->pm, 'sanctum')->postJson('/api/v1/projects', [
            ...$this->payload,
            'target_language_id' => $this->payload['source_language_id'],
        ])->assertUnprocessable()->assertJsonValidationErrors('target_language_id');
    }

    public function test_publish_requires_a_source_file(): void
    {
        $project = $this->createDraft();

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/publish")
            ->assertStatus(422);

        $this->actingAs($this->pm, 'sanctum')->postJson("/api/v1/projects/{$project->id}/files", [
            'file' => UploadedFile::fake()->createWithContent('contract.txt', 'one two three four five'),
            'category' => 'source',
        ])->assertCreated();

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/publish")
            ->assertOk()
            ->assertJsonPath('data.status', 'available');

        $project->refresh();
        $this->assertNotNull($project->published_at);
        $this->assertSame(1, $project->transitions()->count());
    }

    public function test_cancel_requires_reason_and_records_it(): void
    {
        $project = $this->createDraft();

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/cancel", [])
            ->assertUnprocessable();

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/cancel", ['reason' => 'ألغى العميل الطلب'])
            ->assertOk()
            ->assertJsonPath('data.status', 'cancelled')
            ->assertJsonPath('data.cancel_reason', 'ألغى العميل الطلب');
    }

    public function test_completed_project_can_be_archived(): void
    {
        $project = $this->createDraft();
        $project->update(['status' => Project::STATUS_COMPLETED]);

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/archive")
            ->assertOk()
            ->assertJsonPath('data.status', 'archived');

        // Archiving is the terminal step — it cannot be repeated or undone.
        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/archive")
            ->assertStatus(422);
    }

    public function test_only_completed_projects_can_be_archived(): void
    {
        $project = $this->createDraft();

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/archive")
            ->assertStatus(422);

        $translator = User::factory()->create();
        $translator->syncRoles(['translator']);
        $project->update(['status' => Project::STATUS_COMPLETED]);

        $this->actingAs($translator, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/archive")
            ->assertForbidden();
    }

    public function test_invalid_transition_is_rejected(): void
    {
        $project = $this->createDraft();
        $project->update(['status' => Project::STATUS_COMPLETED]);

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/cancel", ['reason' => 'x'])
            ->assertStatus(422);
    }

    public function test_editing_locked_after_draft(): void
    {
        $project = $this->createDraft();
        $project->update(['status' => Project::STATUS_AVAILABLE]);

        $this->actingAs($this->pm, 'sanctum')
            ->putJson("/api/v1/projects/{$project->id}", $this->payload)
            ->assertStatus(422);
    }

    public function test_translator_cannot_create_projects(): void
    {
        $translator = User::factory()->create();
        $translator->syncRoles(['translator']);

        $this->actingAs($translator, 'sanctum')
            ->postJson('/api/v1/projects', $this->payload)
            ->assertForbidden();
    }

    public function test_timeline_lists_transitions_in_order(): void
    {
        $project = $this->createDraft();

        $this->actingAs($this->pm, 'sanctum')->postJson("/api/v1/projects/{$project->id}/files", [
            'file' => UploadedFile::fake()->createWithContent('contract.txt', 'hello world'),
            'category' => 'source',
        ]);
        $this->actingAs($this->pm, 'sanctum')->postJson("/api/v1/projects/{$project->id}/publish");
        $this->actingAs($this->pm, 'sanctum')->postJson("/api/v1/projects/{$project->id}/cancel", ['reason' => 'تجربة']);

        $this->actingAs($this->pm, 'sanctum')
            ->getJson("/api/v1/projects/{$project->id}/timeline")
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.to_status', 'available')
            ->assertJsonPath('data.1.to_status', 'cancelled')
            ->assertJsonPath('data.1.note', 'تجربة');
    }
}
