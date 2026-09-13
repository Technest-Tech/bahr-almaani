<?php

namespace Tests\Feature;

use App\Events\ProjectDeleted;
use App\Models\Language;
use App\Models\Project;
use App\Models\QuoteRequest;
use App\Models\User;
use App\Services\QuoteReferenceGenerator;
use Database\Seeders\LanguageSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Notification;
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

    private function publishedProject(): Project
    {
        $project = $this->createDraft();

        $this->actingAs($this->pm, 'sanctum')->postJson("/api/v1/projects/{$project->id}/files", [
            'file' => UploadedFile::fake()->createWithContent('contract.txt', 'one two three'),
            'category' => 'source',
        ])->assertCreated();
        $this->actingAs($this->pm, 'sanctum')->postJson("/api/v1/projects/{$project->id}/publish")->assertOk();

        return $project->fresh();
    }

    private function translator(): User
    {
        $translator = User::factory()->create();
        $translator->syncRoles(['translator']);

        return $translator;
    }

    public function test_a_draft_project_can_be_deleted(): void
    {
        $project = $this->createDraft();
        $this->actingAs($this->pm, 'sanctum')->postJson("/api/v1/projects/{$project->id}/files", [
            'file' => UploadedFile::fake()->createWithContent('duplicate.txt', 'entered twice'),
            'category' => 'source',
        ])->assertCreated();

        $this->actingAs($this->pm, 'sanctum')->deleteJson("/api/v1/projects/{$project->id}")->assertOk();

        $this->assertSoftDeleted($project);
        $this->actingAs($this->pm, 'sanctum')->getJson("/api/v1/projects/{$project->id}")->assertNotFound();
        $this->actingAs($this->pm, 'sanctum')->getJson('/api/v1/projects')->assertJsonCount(0, 'data');
        $this->assertDatabaseHas('activity_log', ['subject_id' => $project->id, 'event' => 'deleted']);
    }

    public function test_an_available_project_can_be_deleted_and_leaves_the_portal(): void
    {
        Notification::fake();
        Event::fake([ProjectDeleted::class]);
        $project = $this->publishedProject();

        $this->actingAs($this->pm, 'sanctum')->deleteJson("/api/v1/projects/{$project->id}")->assertOk();

        Event::assertDispatched(ProjectDeleted::class, fn (ProjectDeleted $event) => $event->project->is($project));

        $translator = $this->translator();
        $this->actingAs($translator, 'sanctum')->getJson('/api/v1/portal/queue')->assertJsonCount(0, 'data');
        $this->actingAs($translator, 'sanctum')->postJson("/api/v1/portal/claim/{$project->id}")->assertNotFound();
    }

    /** A translator's time and delivery are recorded against the project — cancel it instead. */
    public function test_a_project_a_translator_claimed_cannot_be_deleted(): void
    {
        Notification::fake();
        $project = $this->publishedProject();
        $translator = $this->translator();

        $this->actingAs($translator, 'sanctum')->postJson("/api/v1/portal/claim/{$project->id}")->assertCreated();

        $this->actingAs($this->pm, 'sanctum')
            ->deleteJson("/api/v1/projects/{$project->id}")
            ->assertUnprocessable()
            ->assertJsonPath('message', __('projects.delete_after_claim'));

        // Withdrawn back to the queue, it still carries the first translator's time.
        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/withdraw", ['reason' => 'إجازة مرضية'])
            ->assertOk()
            ->assertJsonPath('data.status', 'available');

        $this->actingAs($this->pm, 'sanctum')
            ->deleteJson("/api/v1/projects/{$project->id}")
            ->assertUnprocessable();

        $this->assertNotSoftDeleted($project);
    }

    public function test_a_cancelled_project_nobody_claimed_can_be_deleted(): void
    {
        $project = $this->createDraft();
        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/cancel", ['reason' => 'مشروع تجريبي'])
            ->assertOk();

        $this->actingAs($this->pm, 'sanctum')->deleteJson("/api/v1/projects/{$project->id}")->assertOk();

        $this->assertSoftDeleted($project);
    }

    public function test_translators_cannot_delete_projects(): void
    {
        $project = $this->createDraft();

        $this->actingAs($this->translator(), 'sanctum')
            ->deleteJson("/api/v1/projects/{$project->id}")
            ->assertForbidden();

        $this->assertNotSoftDeleted($project);
    }

    /** Otherwise the request would point at nothing and refuse to be converted again. */
    public function test_deleting_a_converted_project_hands_its_quote_request_back(): void
    {
        $project = $this->createDraft();
        $quote = QuoteRequest::create([
            'reference' => app(QuoteReferenceGenerator::class)->next(),
            'name' => 'سامي عبد الله',
            'email' => 'sami@example.com',
            'title' => 'ترجمة عقد',
            'service_type' => 'certified',
            'priority' => 'normal',
            'status' => QuoteRequest::STATUS_CONVERTED,
            'project_id' => $project->id,
        ]);

        $this->actingAs($this->pm, 'sanctum')->deleteJson("/api/v1/projects/{$project->id}")->assertOk();

        $quote->refresh();
        $this->assertNull($quote->project_id);
        $this->assertSame(QuoteRequest::STATUS_ACCEPTED, $quote->status);
    }
}
