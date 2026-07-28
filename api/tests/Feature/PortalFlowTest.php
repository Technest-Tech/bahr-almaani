<?php

namespace Tests\Feature;

use App\Models\Assignment;
use App\Models\Language;
use App\Models\LetterheadTemplate;
use App\Models\Project;
use App\Models\ProjectFile;
use App\Models\User;
use App\Notifications\DeadlineAlertNotification;
use App\Notifications\ProjectDeliveredNotification;
use App\Notifications\RevisionRequestedNotification;
use Database\Seeders\LanguageSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class PortalFlowTest extends TestCase
{
    use RefreshDatabase;

    private User $pm;

    private User $translator1; // en → ar

    private User $translator2; // en → ar

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

        foreach (['translator1' => $this->en, 'translator2' => $this->en, 'translator3' => $this->fr] as $key => $source) {
            $translator = User::factory()->create();
            $translator->syncRoles(['translator']);
            $translator->languagePairs()->create([
                'source_language_id' => $source->id,
                'target_language_id' => $this->ar->id,
            ]);
            $this->{$key} = $translator;
        }
    }

    private function makeAvailableProject(array $overrides = []): Project
    {
        $project = Project::create(array_merge([
            'code' => 'BM-2026-'.str_pad((string) random_int(1, 99999), 5, '0', STR_PAD_LEFT),
            'title' => 'مشروع اختبار',
            'source_language_id' => $this->en->id,
            'target_language_id' => $this->ar->id,
            'service_type' => 'certified',
            'priority' => 'normal',
            'status' => Project::STATUS_AVAILABLE,
            'deadline_at' => now()->addDays(2),
            'created_by' => $this->pm->id,
            'published_at' => now(),
        ], $overrides));

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

    /** M9: approval carries the letterhead + stamp the final file will be merged with. */
    private function approvalSelection(): array
    {
        return [
            'letterhead_id' => LetterheadTemplate::factory()->create(['created_by' => $this->pm->id])->id,
            'stamp_id' => LetterheadTemplate::factory()->stamp()->create(['created_by' => $this->pm->id])->id,
        ];
    }

    /** Drives a project all the way to in_review so approval rules can be exercised. */
    private function projectAwaitingApproval(): Project
    {
        $project = $this->makeAvailableProject();

        $this->actingAs($this->translator1, 'sanctum')->postJson("/api/v1/portal/claim/{$project->id}")->assertCreated();
        $this->actingAs($this->translator1, 'sanctum')->postJson('/api/v1/portal/deliver', [
            'file' => UploadedFile::fake()->createWithContent('translation.txt', 'ترجمة'),
        ])->assertOk();
        $this->actingAs($this->pm, 'sanctum')->postJson("/api/v1/projects/{$project->id}/review/open")->assertOk();

        return $project;
    }

    public function test_queue_shows_only_matching_language_pairs(): void
    {
        $this->makeAvailableProject();

        $this->actingAs($this->translator1, 'sanctum')
            ->getJson('/api/v1/portal/queue')->assertOk()->assertJsonCount(1, 'data');

        $this->actingAs($this->translator3, 'sanctum')
            ->getJson('/api/v1/portal/queue')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_queue_orders_by_priority_then_deadline(): void
    {
        $this->makeAvailableProject(['title' => 'عادي قريب', 'priority' => 'normal', 'deadline_at' => now()->addHours(6)]);
        $this->makeAvailableProject(['title' => 'حرج بعيد', 'priority' => 'critical', 'deadline_at' => now()->addDays(5)]);
        $this->makeAvailableProject(['title' => 'عاجل متوسط', 'priority' => 'urgent', 'deadline_at' => now()->addDays(1)]);

        $titles = collect(
            $this->actingAs($this->translator1, 'sanctum')
                ->getJson('/api/v1/portal/queue')->json('data')
        )->pluck('title')->all();

        $this->assertSame(['حرج بعيد', 'عاجل متوسط', 'عادي قريب'], $titles);
    }

    public function test_queue_hides_client_and_pricing_from_translators(): void
    {
        $this->makeAvailableProject(['quoted_amount' => 1500]);

        $item = $this->actingAs($this->translator1, 'sanctum')
            ->getJson('/api/v1/portal/queue')->json('data.0');

        $this->assertArrayNotHasKey('client', $item);
        $this->assertArrayNotHasKey('quoted_amount', $item);
    }

    public function test_claim_is_exclusive(): void
    {
        $project = $this->makeAvailableProject();

        $this->actingAs($this->translator1, 'sanctum')
            ->postJson("/api/v1/portal/claim/{$project->id}")
            ->assertCreated()
            ->assertJsonPath('data.status', 'active');

        $this->assertSame(Project::STATUS_CLAIMED, $project->fresh()->status);

        // Vanishes from the other translator's queue; their claim gets a clean 409.
        $this->actingAs($this->translator2, 'sanctum')
            ->getJson('/api/v1/portal/queue')->assertJsonCount(0, 'data');

        $this->actingAs($this->translator2, 'sanctum')
            ->postJson("/api/v1/portal/claim/{$project->id}")
            ->assertStatus(409);
    }

    public function test_one_active_file_per_translator(): void
    {
        $first = $this->makeAvailableProject();
        $second = $this->makeAvailableProject();

        $this->actingAs($this->translator1, 'sanctum')->postJson("/api/v1/portal/claim/{$first->id}")->assertCreated();

        $this->actingAs($this->translator1, 'sanctum')
            ->postJson("/api/v1/portal/claim/{$second->id}")
            ->assertStatus(409);
    }

    public function test_language_pair_mismatch_is_rejected(): void
    {
        $project = $this->makeAvailableProject();

        $this->actingAs($this->translator3, 'sanctum')
            ->postJson("/api/v1/portal/claim/{$project->id}")
            ->assertStatus(409);
    }

    public function test_pm_cannot_access_portal(): void
    {
        $this->actingAs($this->pm, 'sanctum')->getJson('/api/v1/portal/queue')->assertForbidden();
    }

    public function test_deliver_tracks_work_time_and_notifies_pm(): void
    {
        Notification::fake();
        $project = $this->makeAvailableProject();

        $this->actingAs($this->translator1, 'sanctum')->postJson("/api/v1/portal/claim/{$project->id}")->assertCreated();

        $this->travel(2)->hours();

        $this->actingAs($this->translator1, 'sanctum')->postJson('/api/v1/portal/deliver', [
            'file' => UploadedFile::fake()->createWithContent('translation.txt', 'مرحبا بالعالم'),
        ])->assertOk()->assertJsonPath('data.status', 'delivered');

        $assignment = Assignment::where('project_id', $project->id)->firstOrFail();
        $this->assertEqualsWithDelta(7200, $assignment->work_seconds, 5);
        $this->assertSame(Project::STATUS_DELIVERED, $project->fresh()->status);

        Notification::assertSentTo($this->pm, ProjectDeliveredNotification::class);

        // Delivered file is out of their hands — translator can claim again.
        $next = $this->makeAvailableProject();
        $this->actingAs($this->translator1, 'sanctum')->postJson("/api/v1/portal/claim/{$next->id}")->assertCreated();
    }

    public function test_full_review_cycle_with_revision_loop(): void
    {
        Notification::fake();
        $project = $this->makeAvailableProject();

        // claim + deliver
        $this->actingAs($this->translator1, 'sanctum')->postJson("/api/v1/portal/claim/{$project->id}")->assertCreated();
        $this->actingAs($this->translator1, 'sanctum')->postJson('/api/v1/portal/deliver', [
            'file' => UploadedFile::fake()->createWithContent('v1.txt', 'ترجمة أولى'),
        ])->assertOk();

        // PM opens review and requests a revision (note required)
        $this->actingAs($this->pm, 'sanctum')->postJson("/api/v1/projects/{$project->id}/review/open")->assertOk();

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/review/request-revision", [])
            ->assertUnprocessable();

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/review/request-revision", ['note' => 'راجع المصطلحات القانونية'])
            ->assertOk()
            ->assertJsonPath('data.status', 'revision_requested');

        Notification::assertSentTo($this->translator1, RevisionRequestedNotification::class);

        // Translator sees the revision as their current task with the note
        $current = $this->actingAs($this->translator1, 'sanctum')->getJson('/api/v1/portal/current');
        $current->assertOk();
        $this->assertSame('راجع المصطلحات القانونية', $current->json('revision_note.note'));

        // While a revision is pending, claiming anything else is blocked
        $other = $this->makeAvailableProject();
        $this->actingAs($this->translator1, 'sanctum')
            ->postJson("/api/v1/portal/claim/{$other->id}")
            ->assertStatus(409);

        // Re-deliver, PM approves, finalize job completes the project (sync queue in tests)
        $this->actingAs($this->translator1, 'sanctum')->postJson('/api/v1/portal/deliver', [
            'file' => UploadedFile::fake()->createWithContent('v2.txt', 'ترجمة منقحة'),
        ])->assertOk();

        $this->actingAs($this->pm, 'sanctum')->postJson("/api/v1/projects/{$project->id}/review/open")->assertOk();
        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/review/approve", $this->approvalSelection())
            ->assertOk();

        $project->refresh();
        $this->assertSame(Project::STATUS_COMPLETED, $project->status);
        $this->assertNotNull($project->completed_at);
        $this->assertSame(1, $project->files()->where('category', ProjectFile::CATEGORY_FINAL)->count());
        $this->assertSame(2, $project->files()->where('category', ProjectFile::CATEGORY_DELIVERABLE)->count());
    }

    public function test_approval_requires_an_active_letterhead_and_stamp(): void
    {
        Notification::fake();
        $project = $this->projectAwaitingApproval();

        // No selection at all.
        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/review/approve")
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['letterhead_id', 'stamp_id']);

        // Kinds swapped — a stamp is not a letterhead.
        $letterhead = LetterheadTemplate::factory()->create(['created_by' => $this->pm->id]);
        $stamp = LetterheadTemplate::factory()->stamp()->create(['created_by' => $this->pm->id]);

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/review/approve", [
                'letterhead_id' => $stamp->id,
                'stamp_id' => $letterhead->id,
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['letterhead_id', 'stamp_id']);

        // Deactivated templates are out of circulation.
        $retired = LetterheadTemplate::factory()->inactive()->create(['created_by' => $this->pm->id]);

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/review/approve", [
                'letterhead_id' => $retired->id,
                'stamp_id' => $stamp->id,
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('letterhead_id');

        // Nothing was persisted or transitioned by the rejected attempts.
        $project->refresh();
        $this->assertSame(Project::STATUS_IN_REVIEW, $project->status);
        $this->assertNull($project->letterhead_id);
        $this->assertNull($project->stamp_id);
    }

    public function test_approval_stores_the_selection_for_the_merge_job(): void
    {
        Notification::fake();
        $project = $this->projectAwaitingApproval();

        $letterhead = LetterheadTemplate::factory()->create(['created_by' => $this->pm->id]);
        $stamp = LetterheadTemplate::factory()->stamp()->create(['created_by' => $this->pm->id]);

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/review/approve", [
                'letterhead_id' => $letterhead->id,
                'stamp_id' => $stamp->id,
            ])
            ->assertOk()
            ->assertJsonPath('data.letterhead.id', $letterhead->id)
            ->assertJsonPath('data.stamp.id', $stamp->id)
            ->assertJsonPath('data.stamp.placement.anchor', 'bottom-right');

        $project->refresh();
        $this->assertSame($letterhead->id, $project->letterhead_id);
        $this->assertSame($stamp->id, $project->stamp_id);
        $this->assertSame(Project::STATUS_COMPLETED, $project->status);

        // The chosen templates are now referenced and must survive a delete attempt.
        $this->assertTrue($letterhead->fresh()->isUsedByProjects());
    }

    public function test_an_invalid_transition_does_not_persist_the_selection(): void
    {
        Notification::fake();
        $project = $this->makeAvailableProject(); // still `available`, review cannot open

        $selection = $this->approvalSelection();

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/review/approve", $selection)
            ->assertUnprocessable();

        $project->refresh();
        $this->assertSame(Project::STATUS_AVAILABLE, $project->status);
        $this->assertNull($project->letterhead_id);
        $this->assertNull($project->stamp_id);
    }

    public function test_withdraw_releases_translator_and_republishes(): void
    {
        Notification::fake();
        $project = $this->makeAvailableProject();

        $this->actingAs($this->translator1, 'sanctum')->postJson("/api/v1/portal/claim/{$project->id}")->assertCreated();

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/withdraw", ['reason' => 'المترجم في إجازة مرضية'])
            ->assertOk()
            ->assertJsonPath('data.status', 'available');

        $assignment = Assignment::where('project_id', $project->id)->firstOrFail();
        $this->assertSame(Assignment::STATUS_WITHDRAWN, $assignment->status);
        $this->assertSame('المترجم في إجازة مرضية', $assignment->withdraw_reason);

        // The withdrawn translator is unlocked and the file is claimable again (by anyone).
        $this->actingAs($this->translator2, 'sanctum')->postJson("/api/v1/portal/claim/{$project->id}")->assertCreated();
    }

    public function test_deadline_scanner_fires_once_per_level(): void
    {
        Notification::fake();

        $dueSoon = $this->makeAvailableProject(['deadline_at' => now()->addHours(3)]);
        $late = $this->makeAvailableProject(['deadline_at' => now()->subHour()]);

        $this->artisan('projects:scan-deadlines')->assertSuccessful();

        Notification::assertSentTo($this->pm, DeadlineAlertNotification::class, fn ($n) => $n->level === 'due_soon' && $n->project->is($dueSoon));
        Notification::assertSentTo($this->pm, DeadlineAlertNotification::class, fn ($n) => $n->level === 'late' && $n->project->is($late));

        // Second run: flags are set, nothing new fires.
        Notification::fake();
        $this->artisan('projects:scan-deadlines')->assertSuccessful();
        Notification::assertNothingSent();
    }

    public function test_notifications_endpoint_lists_and_marks_read(): void
    {
        $project = $this->makeAvailableProject();
        $this->actingAs($this->translator1, 'sanctum')->postJson("/api/v1/portal/claim/{$project->id}")->assertCreated();
        $this->actingAs($this->translator1, 'sanctum')->postJson('/api/v1/portal/deliver', [
            'file' => UploadedFile::fake()->createWithContent('t.txt', 'نص'),
        ])->assertOk();

        $list = $this->actingAs($this->pm, 'sanctum')->getJson('/api/v1/notifications');
        $list->assertOk();
        $this->assertSame(1, $list->json('unread_count'));

        $this->actingAs($this->pm, 'sanctum')->putJson('/api/v1/notifications/read-all')->assertOk();

        $this->assertSame(
            0,
            $this->actingAs($this->pm, 'sanctum')->getJson('/api/v1/notifications')->json('unread_count'),
        );
    }
}
