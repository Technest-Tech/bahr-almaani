<?php

namespace Tests\Feature;

use App\Events\ProjectCancelled;
use App\Events\ProjectClaimed;
use App\Events\ProjectDelivered;
use App\Events\ProjectPublished;
use App\Events\ProjectWithdrawn;
use App\Models\Language;
use App\Models\Project;
use App\Models\ProjectFile;
use App\Models\User;
use Database\Seeders\LanguageSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class RealtimeBroadcastingTest extends TestCase
{
    use RefreshDatabase;

    private User $pm;

    private User $translator1; // en → ar

    private User $translator3; // fr → ar

    private Language $en;

    private Language $ar;

    private Language $fr;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->seed(LanguageSeeder::class);
        Storage::fake('local');

        $this->en = Language::where('code', 'en')->firstOrFail();
        $this->ar = Language::where('code', 'ar')->firstOrFail();
        $this->fr = Language::where('code', 'fr')->firstOrFail();

        $this->pm = User::factory()->create();
        $this->pm->syncRoles(['project_manager']);

        foreach (['translator1' => $this->en, 'translator3' => $this->fr] as $key => $source) {
            $translator = User::factory()->create();
            $translator->syncRoles(['translator']);
            $translator->languagePairs()->create([
                'source_language_id' => $source->id,
                'target_language_id' => $this->ar->id,
            ]);
            $this->{$key} = $translator;
        }
    }

    /** One shared feed — the queue is no longer scoped per language pair. */
    private function portalChannel(): string
    {
        return 'private-portal';
    }

    /**
     * phpunit.xml runs on the null broadcaster (which skips channel callbacks and
     * would break unfaked event/notification broadcasts elsewhere), so only the
     * auth-endpoint tests pin the signing reverb driver. Signing is local HMAC —
     * no websocket server involved.
     */
    private function authTo(User $user, string $channel)
    {
        config(['broadcasting.default' => 'reverb']);

        // Channel callbacks bind to the default driver at boot (null under phpunit),
        // so re-register them on the reverb driver we just switched to.
        require base_path('routes/channels.php');

        return $this->actingAs($user, 'sanctum')->postJson('/broadcasting/auth', [
            'channel_name' => $channel,
            'socket_id' => '123.456',
        ]);
    }

    private function makeAvailableProject(): Project
    {
        $project = Project::create([
            'code' => 'BM-2026-'.str_pad((string) random_int(1, 99999), 5, '0', STR_PAD_LEFT),
            'title' => 'مشروع بث',
            'source_language_id' => $this->en->id,
            'target_language_id' => $this->ar->id,
            'service_type' => 'certified',
            'priority' => 'normal',
            'status' => Project::STATUS_AVAILABLE,
            'deadline_at' => now()->addDays(2),
            'created_by' => $this->pm->id,
            'published_at' => now(),
        ]);

        $project->files()->create([
            'category' => ProjectFile::CATEGORY_SOURCE,
            'uploaded_by' => $this->pm->id,
            'original_name' => 'source.txt',
            'disk_path' => UploadedFile::fake()->createWithContent('source.txt', 'hello world')->store("projects/{$project->id}/source", 'local'),
            'size_bytes' => 11,
            'count_status' => ProjectFile::COUNT_DONE,
            'word_count' => 2,
        ]);

        return $project;
    }

    // ── Channel authorization ────────────────────────────────────────────

    public function test_any_translator_joins_the_portal_channel(): void
    {
        $this->authTo($this->translator1, $this->portalChannel())
            ->assertOk()
            ->assertJsonStructure(['auth']);
    }

    /**
     * translator3 works fr→ar and the feed carries en→ar files. It used to be
     * refused; now portal access alone decides, so it must be admitted — a
     * translator who can see a file has to hear when someone else takes it.
     */
    public function test_a_translator_outside_the_pair_still_joins_the_portal_channel(): void
    {
        $this->authTo($this->translator3, $this->portalChannel())
            ->assertOk()
            ->assertJsonStructure(['auth']);
    }

    public function test_pm_without_portal_access_is_rejected_from_portal_channel(): void
    {
        $this->authTo($this->pm, $this->portalChannel())->assertForbidden();
    }

    public function test_guests_cannot_authorize_channels(): void
    {
        $this->postJson('/broadcasting/auth', [
            'channel_name' => $this->portalChannel(),
            'socket_id' => '123.456',
        ])->assertUnauthorized();
    }

    public function test_suspended_translator_is_rejected(): void
    {
        $this->translator1->forceFill(['status' => User::STATUS_SUSPENDED])->save();

        $this->authTo($this->translator1, $this->portalChannel())->assertForbidden();
    }

    public function test_user_channel_is_private_to_its_owner(): void
    {
        $this->authTo($this->pm, "private-App.Models.User.{$this->pm->id}")
            ->assertOk()
            ->assertJsonStructure(['auth']);

        $this->authTo($this->translator1, "private-App.Models.User.{$this->pm->id}")
            ->assertForbidden();
    }

    // ── Event dispatch ───────────────────────────────────────────────────

    public function test_publish_broadcasts_to_the_language_pair_channel(): void
    {
        Event::fake([ProjectPublished::class]);

        $project = $this->makeAvailableProject();
        $project->update(['status' => Project::STATUS_DRAFT, 'published_at' => null]);

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/publish")
            ->assertOk();

        Event::assertDispatched(ProjectPublished::class, fn (ProjectPublished $event) => $event->project->is($project)
            && $event->broadcastOn()[0]->name === $this->portalChannel()
            && $event->broadcastWith()['project']['status'] === Project::STATUS_AVAILABLE);
    }

    public function test_claim_broadcasts_so_other_queues_drop_the_card(): void
    {
        Event::fake([ProjectClaimed::class]);

        $project = $this->makeAvailableProject();

        $this->actingAs($this->translator1, 'sanctum')
            ->postJson("/api/v1/portal/claim/{$project->id}")
            ->assertCreated();

        Event::assertDispatched(ProjectClaimed::class, fn (ProjectClaimed $event) => $event->project->is($project)
            && $event->broadcastOn()[0]->name === $this->portalChannel()
            && $event->broadcastWith()['project']['status'] === Project::STATUS_CLAIMED);
    }

    public function test_failed_claim_broadcasts_nothing(): void
    {
        Event::fake([ProjectClaimed::class]);

        $project = $this->makeAvailableProject();
        $project->update(['status' => Project::STATUS_CLAIMED]);

        $this->actingAs($this->translator1, 'sanctum')
            ->postJson("/api/v1/portal/claim/{$project->id}")
            ->assertStatus(409);

        Event::assertNotDispatched(ProjectClaimed::class);
    }

    public function test_withdraw_broadcasts_the_project_back_to_the_queue(): void
    {
        Event::fake([ProjectWithdrawn::class]);

        $project = $this->makeAvailableProject();
        $this->actingAs($this->translator1, 'sanctum')->postJson("/api/v1/portal/claim/{$project->id}")->assertCreated();

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/withdraw", ['reason' => 'إجازة مرضية'])
            ->assertOk();

        Event::assertDispatched(ProjectWithdrawn::class, fn (ProjectWithdrawn $event) => $event->project->is($project)
            && $event->broadcastOn()[0]->name === $this->portalChannel()
            && $event->broadcastWith()['project']['status'] === Project::STATUS_AVAILABLE);
    }

    public function test_deliver_broadcasts_to_the_project_creator(): void
    {
        Event::fake([ProjectDelivered::class]);

        $project = $this->makeAvailableProject();
        $this->actingAs($this->translator1, 'sanctum')->postJson("/api/v1/portal/claim/{$project->id}")->assertCreated();

        $this->actingAs($this->translator1, 'sanctum')->postJson('/api/v1/portal/deliver', [
            'file' => UploadedFile::fake()->createWithContent('t.txt', 'ترجمة'),
        ])->assertOk();

        Event::assertDispatched(ProjectDelivered::class, fn (ProjectDelivered $event) => $event->project->is($project)
            && $event->broadcastOn()[0]->name === "private-App.Models.User.{$this->pm->id}"
            && $event->broadcastWith()['translator']['name'] === $this->translator1->name);
    }

    public function test_cancel_broadcasts_only_for_portal_visible_projects(): void
    {
        Event::fake([ProjectCancelled::class]);

        $available = $this->makeAvailableProject();
        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$available->id}/cancel", ['reason' => 'ألغى العميل الطلب'])
            ->assertOk();

        Event::assertDispatched(ProjectCancelled::class, fn (ProjectCancelled $event) => $event->project->is($available));

        // A draft was never on anyone's screen — nothing to broadcast.
        Event::fake([ProjectCancelled::class]);
        $draft = $this->makeAvailableProject();
        $draft->update(['status' => Project::STATUS_DRAFT, 'published_at' => null]);

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$draft->id}/cancel", ['reason' => 'مسودة ملغاة'])
            ->assertOk();

        Event::assertNotDispatched(ProjectCancelled::class);
    }

    public function test_portal_payload_never_leaks_client_or_pricing(): void
    {
        $project = $this->makeAvailableProject();
        $payload = (new ProjectPublished($project))->broadcastWith();

        $this->assertSame(
            ['id', 'code', 'title', 'priority', 'status', 'deadline_at'],
            array_keys($payload['project']),
        );
    }
}
