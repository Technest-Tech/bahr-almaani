<?php

namespace Tests\Feature;

use App\Jobs\CountWordsJob;
use App\Models\Client;
use App\Models\Language;
use App\Models\Project;
use App\Models\ProjectFile;
use App\Models\User;
use App\Notifications\ClientProjectSubmittedNotification;
use App\Notifications\DocumentSuppliedNotification;
use Database\Seeders\LanguageSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * A signed-in client starts a project from their own area (2026-09-19).
 *
 * Before this, a client with an account still went through the public quote form
 * for every job. The properties that matter: the submission is a draft, so nothing
 * reaches a translator until a PM publishes it; the client can see their own draft
 * but never the office's; and the files to translate are theirs to change only
 * until publication.
 */
class ClientProjectSubmissionTest extends TestCase
{
    use RefreshDatabase;

    private User $pm;

    private Client $client;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->seed(LanguageSeeder::class);
        Storage::fake('local');
        Queue::fake([CountWordsJob::class]);

        $this->pm = User::factory()->create();
        $this->pm->syncRoles(['project_manager']);

        $this->client = Client::create([
            'name' => 'شركة النور',
            'type' => 'company',
            'email' => 'noor@example.com',
            'password' => 'secret-passphrase',
        ]);
    }

    private function payload(array $overrides = []): array
    {
        return [
            'source_language_id' => Language::where('code', 'ar')->first()->id,
            'target_language_id' => Language::where('code', 'en')->first()->id,
            'service_type' => 'certified',
            'priority' => 'urgent',
            'declared_pages' => 3,
            'deadline_at' => now()->addDays(3)->toIso8601String(),
            'instructions' => 'مطلوب للسفارة الألمانية.',
            'files' => [
                UploadedFile::fake()->create('عقد-تأسيس.pdf', 120, 'application/pdf'),
                UploadedFile::fake()->create('ملحق.docx', 40, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
            ],
            ...$overrides,
        ];
    }

    private function submit(array $overrides = []): Project
    {
        $id = $this->actingAs($this->client, 'client')
            ->postJson('/api/v1/client/projects', $this->payload($overrides))
            ->assertCreated()
            ->json('data.id');

        return Project::findOrFail($id);
    }

    public function test_a_client_starts_a_project_from_their_own_area(): void
    {
        Notification::fake();

        $response = $this->actingAs($this->client, 'client')
            ->postJson('/api/v1/client/projects', $this->payload())
            ->assertCreated()
            ->assertJsonPath('data.stage', 'submitted')
            // Named after the first file, as the office's blank name is.
            ->assertJsonPath('data.title', 'عقد-تأسيس');

        $project = Project::findOrFail($response->json('data.id'));

        // A draft: nothing reaches a translator until a PM publishes it.
        $this->assertSame(Project::STATUS_DRAFT, $project->status);
        $this->assertTrue($project->client_submitted);
        $this->assertSame($this->client->id, $project->client_id);
        $this->assertNull($project->created_by);
        $this->assertSame('urgent', $project->priority);
        $this->assertSame('مطلوب للسفارة الألمانية.', $project->instructions);

        // The documents are the job itself: work files, counted, and the client's own.
        $files = $project->files()->get();
        $this->assertCount(2, $files);

        foreach ($files as $file) {
            $this->assertSame(ProjectFile::CATEGORY_SOURCE, $file->category);
            $this->assertSame($this->client->id, $file->uploaded_by_client_id);
            $this->assertNull($file->uploaded_by);
            Storage::disk('local')->assertExists($file->disk_path);
        }

        Queue::assertPushed(CountWordsJob::class, 2);

        Notification::assertSentTo(
            $this->pm,
            ClientProjectSubmittedNotification::class,
            fn (ClientProjectSubmittedNotification $n) => $n->project->is($project) && $n->fileCount === 2,
        );
    }

    public function test_a_typed_name_is_kept(): void
    {
        $project = $this->submit(['title' => 'عقد تأسيس شركة النور']);

        $this->assertSame('عقد تأسيس شركة النور', $project->title);
        $this->assertFalse($project->title_auto);
    }

    public function test_a_submission_needs_files_a_language_pair_and_a_future_date(): void
    {
        $this->actingAs($this->client, 'client')
            ->postJson('/api/v1/client/projects', $this->payload([
                'files' => [],
                'target_language_id' => Language::where('code', 'ar')->first()->id,
                'deadline_at' => now()->subDay()->toIso8601String(),
            ]))
            ->assertStatus(422)
            ->assertJsonValidationErrors(['files', 'target_language_id', 'deadline_at']);

        $this->actingAs($this->client, 'client')
            ->postJson('/api/v1/client/projects', $this->payload([
                'files' => [UploadedFile::fake()->create('setup.exe', 10, 'application/octet-stream')],
            ]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('files.0');

        $this->assertSame(0, Project::count());
    }

    public function test_only_a_signed_in_client_can_submit(): void
    {
        $this->postJson('/api/v1/client/projects', $this->payload())->assertUnauthorized();

        // A staff token belongs to the other guard and never reaches the client area.
        $this->withToken($this->pm->createToken('spa')->plainTextToken)
            ->postJson('/api/v1/client/projects', $this->payload())
            ->assertUnauthorized();

        $this->assertSame(0, Project::count());
    }

    public function test_the_client_follows_their_own_draft_but_never_the_offices(): void
    {
        $mine = $this->submit();

        // The office's own draft for the same client: still internal.
        $officeDraft = Project::create([
            'code' => 'BM-2026-90001',
            'client_id' => $this->client->id,
            'title' => 'قيد الإعداد',
            'source_language_id' => $mine->source_language_id,
            'target_language_id' => $mine->target_language_id,
            'service_type' => 'certified',
            'priority' => 'normal',
            'status' => Project::STATUS_DRAFT,
            'deadline_at' => now()->addDay(),
            'created_by' => $this->pm->id,
        ]);

        $this->actingAs($this->client, 'client')
            ->getJson('/api/v1/client/projects')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $mine->id);

        $this->actingAs($this->client, 'client')
            ->getJson('/api/v1/client/projects?stage=submitted')
            ->assertOk()
            ->assertJsonCount(1, 'data');

        $overview = $this->actingAs($this->client, 'client')->getJson('/api/v1/client/overview')->assertOk();
        $this->assertSame(1, $overview->json('stats.projects_total'));
        $this->assertSame(1, $overview->json('stats.by_stage.submitted'));

        $this->actingAs($this->client, 'client')
            ->getJson("/api/v1/client/projects/{$mine->id}")
            ->assertOk()
            ->assertJsonCount(2, 'data.files');

        $this->actingAs($this->client, 'client')
            ->getJson("/api/v1/client/projects/{$officeDraft->id}")
            ->assertNotFound();
    }

    public function test_the_client_can_change_the_files_until_the_office_publishes(): void
    {
        Notification::fake();

        $project = $this->submit();
        $wrong = $project->files()->where('original_name', 'ملحق.docx')->firstOrFail();

        // The wrong file out, the right one in.
        $this->actingAs($this->client, 'client')
            ->deleteJson("/api/v1/client/projects/{$project->id}/files/{$wrong->id}")
            ->assertOk();

        Storage::disk('local')->assertMissing($wrong->disk_path);

        $this->actingAs($this->client, 'client')
            ->postJson("/api/v1/client/projects/{$project->id}/files", [
                'category' => 'source',
                'files' => [UploadedFile::fake()->create('ملحق-صحيح.docx', 40)],
            ])
            ->assertCreated()
            ->assertJsonPath('data.0.category', 'source');

        $this->assertEqualsCanonicalizing(
            ['عقد-تأسيس.pdf', 'ملحق-صحيح.docx'],
            $project->files()->where('category', ProjectFile::CATEGORY_SOURCE)->pluck('original_name')->all(),
        );

        // Nobody owns the draft yet, so every PM hears about it.
        Notification::assertSentTo(
            $this->pm,
            DocumentSuppliedNotification::class,
            fn (DocumentSuppliedNotification $n) => $n->toTranslate && $n->fileCount === 1,
        );

        // Published: the work files are frozen, for the client as for the office.
        $this->actingAs($this->pm, 'sanctum')->postJson("/api/v1/projects/{$project->id}/publish")->assertOk();

        $this->actingAs($this->client, 'client')
            ->postJson("/api/v1/client/projects/{$project->id}/files", [
                'category' => 'source',
                'files' => [UploadedFile::fake()->create('صفحة-أخرى.pdf', 40, 'application/pdf')],
            ])
            ->assertStatus(422);

        $source = $project->files()->where('category', ProjectFile::CATEGORY_SOURCE)->firstOrFail();

        $this->actingAs($this->client, 'client')
            ->deleteJson("/api/v1/client/projects/{$project->id}/files/{$source->id}")
            ->assertStatus(422);

        $this->assertSame(2, $project->files()->where('category', ProjectFile::CATEGORY_SOURCE)->count());

        // Anything more is still welcome — as supporting material.
        $this->actingAs($this->client, 'client')
            ->postJson("/api/v1/client/projects/{$project->id}/files", [
                'files' => [UploadedFile::fake()->image('passport.jpg')],
            ])
            ->assertCreated()
            ->assertJsonPath('data.0.category', 'reference');
    }

    public function test_files_to_translate_go_only_onto_the_clients_own_draft(): void
    {
        // A project the office opened and published for this client.
        $live = Project::create([
            'code' => 'BM-2026-90002',
            'client_id' => $this->client->id,
            'title' => 'شهادة ميلاد',
            'source_language_id' => Language::where('code', 'ar')->first()->id,
            'target_language_id' => Language::where('code', 'en')->first()->id,
            'service_type' => 'certified',
            'priority' => 'normal',
            'status' => Project::STATUS_CLAIMED,
            'deadline_at' => now()->addDay(),
            'created_by' => $this->pm->id,
        ]);

        $this->actingAs($this->client, 'client')
            ->postJson("/api/v1/client/projects/{$live->id}/files", [
                'category' => 'source',
                'files' => [UploadedFile::fake()->create('page-2.pdf', 40, 'application/pdf')],
            ])
            ->assertStatus(422);

        $this->assertSame(0, $live->files()->count());
    }

    public function test_the_first_pm_to_edit_the_draft_takes_it(): void
    {
        $project = $this->submit();

        // The office sees where it came from, and that nobody owns it yet.
        $this->actingAs($this->pm, 'sanctum')
            ->getJson("/api/v1/projects/{$project->id}")
            ->assertOk()
            ->assertJsonPath('data.client_submitted', true)
            ->assertJsonPath('data.creator', null);

        $this->actingAs($this->pm, 'sanctum')
            ->putJson("/api/v1/projects/{$project->id}", [
                'title' => 'عقد تأسيس',
                'source_language_id' => $project->source_language_id,
                'target_language_id' => $project->target_language_id,
                'service_type' => 'certified',
                'priority' => 'normal',
                'deadline_at' => now()->addDays(5)->toIso8601String(),
            ])
            ->assertOk();

        $this->assertSame($this->pm->id, $project->fresh()->created_by);

        // A second PM editing afterwards does not take it over.
        $other = User::factory()->create();
        $other->syncRoles(['admin']);

        $this->actingAs($other, 'sanctum')
            ->putJson("/api/v1/projects/{$project->id}", [
                'title' => 'عقد تأسيس شركة',
                'source_language_id' => $project->source_language_id,
                'target_language_id' => $project->target_language_id,
                'service_type' => 'certified',
                'priority' => 'normal',
                'deadline_at' => now()->addDays(5)->toIso8601String(),
            ])
            ->assertOk();

        $this->assertSame($this->pm->id, $project->fresh()->created_by);
    }

    public function test_publishing_an_untouched_submission_gives_it_an_owner(): void
    {
        Notification::fake();

        $project = $this->submit();

        $this->actingAs($this->pm, 'sanctum')->postJson("/api/v1/projects/{$project->id}/publish")->assertOk();

        $project->refresh();
        $this->assertSame(Project::STATUS_AVAILABLE, $project->status);
        $this->assertSame($this->pm->id, $project->created_by);

        // And the client now sees it moving.
        $this->actingAs($this->client, 'client')
            ->getJson("/api/v1/client/projects/{$project->id}")
            ->assertOk()
            ->assertJsonPath('data.stage', 'in_progress');
    }

    public function test_a_publish_that_fails_does_not_take_the_project(): void
    {
        // Two PMs publish the same submission at once. The loser's publish is
        // refused ("available → available"); it used to have already saved itself
        // as the owner, taking the project off the winner's list.
        Notification::fake();

        $project = $this->submit();
        $project->forceFill(['status' => Project::STATUS_AVAILABLE])->save();

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/publish")
            ->assertStatus(422);

        $this->assertNull($project->fresh()->created_by);
    }
}
