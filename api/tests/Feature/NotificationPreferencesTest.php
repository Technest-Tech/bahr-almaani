<?php

namespace Tests\Feature;

use App\Models\Language;
use App\Models\Project;
use App\Models\ProjectFile;
use App\Models\User;
use App\Notifications\DeadlineAlertNotification;
use App\Notifications\ProjectAvailableNotification;
use App\Notifications\ProjectDeliveredNotification;
use App\Support\NotificationPreferences;
use Database\Seeders\LanguageSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class NotificationPreferencesTest extends TestCase
{
    use RefreshDatabase;

    private User $pm;

    private User $translator;

    private Language $en;

    private Language $ar;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->seed(LanguageSeeder::class);
        Storage::fake('local');

        $this->en = Language::where('code', 'en')->firstOrFail();
        $this->ar = Language::where('code', 'ar')->firstOrFail();

        $this->pm = User::factory()->create();
        $this->pm->syncRoles(['project_manager']);

        $this->translator = User::factory()->create();
        $this->translator->syncRoles(['translator']);
        $this->translator->languagePairs()->create([
            'source_language_id' => $this->en->id,
            'target_language_id' => $this->ar->id,
        ]);
    }

    private function makeProject(array $overrides = []): Project
    {
        $project = Project::create(array_merge([
            'code' => 'BM-2026-'.str_pad((string) random_int(1, 99999), 5, '0', STR_PAD_LEFT),
            'title' => 'مشروع اختبار التفضيلات',
            'source_language_id' => $this->en->id,
            'target_language_id' => $this->ar->id,
            'service_type' => 'certified',
            'priority' => 'normal',
            'status' => Project::STATUS_DRAFT,
            'deadline_at' => now()->addDays(2),
            'created_by' => $this->pm->id,
        ], $overrides));

        $project->files()->create([
            'category' => ProjectFile::CATEGORY_SOURCE,
            'uploaded_by' => $this->pm->id,
            'original_name' => 'source.txt',
            'disk_path' => UploadedFile::fake()
                ->createWithContent('source.txt', 'hello world')
                ->store("projects/{$project->id}/source", 'local'),
            'size_bytes' => 11,
            'count_status' => ProjectFile::COUNT_DONE,
            'word_count' => 2,
        ]);

        return $project;
    }

    public function test_defaults_are_returned_when_nothing_is_stored(): void
    {
        $response = $this->actingAs($this->pm, 'sanctum')->getJson('/api/v1/notification-preferences');

        $response->assertOk()
            ->assertJsonCount(count(NotificationPreferences::keys()), 'families');

        foreach (NotificationPreferences::keys() as $family) {
            $response->assertJsonPath("data.{$family}", true);
        }

        // Families carry the Arabic presentation metadata the settings screen renders.
        $this->assertSame(NotificationPreferences::PROJECT_AVAILABLE, $response->json('families.0.key'));
        $this->assertNotEmpty($response->json('families.0.label'));
        $this->assertNotEmpty($response->json('families.0.description'));
    }

    public function test_guests_cannot_read_or_write_preferences(): void
    {
        $this->getJson('/api/v1/notification-preferences')->assertUnauthorized();
        $this->putJson('/api/v1/notification-preferences', ['preferences' => []])->assertUnauthorized();
    }

    public function test_preferences_are_persisted_and_partial_updates_keep_the_rest(): void
    {
        $this->actingAs($this->pm, 'sanctum')
            ->putJson('/api/v1/notification-preferences', [
                'preferences' => [
                    NotificationPreferences::PROJECT_DELIVERED => false,
                    NotificationPreferences::DEADLINE_ALERTS => false,
                ],
            ])
            ->assertOk()
            ->assertJsonPath('data.'.NotificationPreferences::PROJECT_DELIVERED, false)
            ->assertJsonPath('data.'.NotificationPreferences::DEADLINE_ALERTS, false)
            ->assertJsonPath('data.'.NotificationPreferences::REPORT_READY, true);

        $this->assertDatabaseHas('notification_preferences', [
            'user_id' => $this->pm->id,
            'family' => NotificationPreferences::PROJECT_DELIVERED,
            'mail' => false,
        ]);

        // A second partial write only touches the family it names.
        $this->actingAs($this->pm, 'sanctum')
            ->putJson('/api/v1/notification-preferences', [
                'preferences' => [NotificationPreferences::PROJECT_DELIVERED => true],
            ])
            ->assertOk()
            ->assertJsonPath('data.'.NotificationPreferences::PROJECT_DELIVERED, true)
            ->assertJsonPath('data.'.NotificationPreferences::DEADLINE_ALERTS, false);

        // updateOrCreate, not insert — one row per (user, family).
        $this->assertSame(2, $this->pm->notificationPreferences()->count());
    }

    public function test_unknown_families_and_non_boolean_values_are_rejected(): void
    {
        $this->actingAs($this->pm, 'sanctum')
            ->putJson('/api/v1/notification-preferences', ['preferences' => ['nope' => false]])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('preferences');

        $this->actingAs($this->pm, 'sanctum')
            ->putJson('/api/v1/notification-preferences', [
                'preferences' => [NotificationPreferences::REPORT_READY => 'maybe'],
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('preferences.'.NotificationPreferences::REPORT_READY);

        $this->actingAs($this->pm, 'sanctum')
            ->putJson('/api/v1/notification-preferences', [])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('preferences');
    }

    public function test_preferences_are_per_user(): void
    {
        $this->actingAs($this->pm, 'sanctum')
            ->putJson('/api/v1/notification-preferences', [
                'preferences' => [NotificationPreferences::PROJECT_DELIVERED => false],
            ])
            ->assertOk();

        $this->actingAs($this->translator, 'sanctum')
            ->getJson('/api/v1/notification-preferences')
            ->assertOk()
            ->assertJsonPath('data.'.NotificationPreferences::PROJECT_DELIVERED, true);

        $this->assertFalse($this->pm->fresh()->wantsMail(NotificationPreferences::PROJECT_DELIVERED));
        $this->assertTrue($this->translator->fresh()->wantsMail(NotificationPreferences::PROJECT_DELIVERED));
    }

    public function test_opting_out_drops_mail_but_keeps_the_bell_and_broadcast(): void
    {
        $this->pm->notificationPreferences()->create([
            'family' => NotificationPreferences::PROJECT_DELIVERED,
            'mail' => false,
        ]);

        Notification::fake();
        $project = $this->makeProject(['status' => Project::STATUS_AVAILABLE, 'published_at' => now()]);

        $this->actingAs($this->translator, 'sanctum')
            ->postJson("/api/v1/portal/claim/{$project->id}")->assertCreated();
        $this->actingAs($this->translator, 'sanctum')
            ->postJson('/api/v1/portal/deliver', [
                'file' => UploadedFile::fake()->createWithContent('t.txt', 'ترجمة'),
            ])->assertOk();

        Notification::assertSentTo(
            $this->pm,
            ProjectDeliveredNotification::class,
            function (ProjectDeliveredNotification $notification, array $channels): bool {
                $this->assertContains('database', $channels);
                $this->assertContains('broadcast', $channels);
                $this->assertNotContains('mail', $channels);

                return true;
            },
        );
    }

    public function test_mail_stays_on_by_default(): void
    {
        Notification::fake();
        $project = $this->makeProject(['status' => Project::STATUS_AVAILABLE, 'published_at' => now()]);

        $this->actingAs($this->translator, 'sanctum')
            ->postJson("/api/v1/portal/claim/{$project->id}")->assertCreated();
        $this->actingAs($this->translator, 'sanctum')
            ->postJson('/api/v1/portal/deliver', [
                'file' => UploadedFile::fake()->createWithContent('t.txt', 'ترجمة'),
            ])->assertOk();

        Notification::assertSentTo(
            $this->pm,
            ProjectDeliveredNotification::class,
            fn (ProjectDeliveredNotification $notification, array $channels): bool => in_array('mail', $channels, true),
        );
    }

    public function test_deadline_alerts_respect_the_preference(): void
    {
        $this->pm->notificationPreferences()->create([
            'family' => NotificationPreferences::DEADLINE_ALERTS,
            'mail' => false,
        ]);

        Notification::fake();
        $this->makeProject([
            'status' => Project::STATUS_AVAILABLE,
            'published_at' => now(),
            'deadline_at' => now()->subHour(),
        ]);

        $this->artisan('projects:scan-deadlines')->assertSuccessful();

        Notification::assertSentTo(
            $this->pm,
            DeadlineAlertNotification::class,
            fn (DeadlineAlertNotification $notification, array $channels): bool => ! in_array('mail', $channels, true),
        );
    }

    public function test_project_available_mail_is_opt_out_per_translator(): void
    {
        $optedOut = User::factory()->create();
        $optedOut->syncRoles(['translator']);
        $optedOut->languagePairs()->create([
            'source_language_id' => $this->en->id,
            'target_language_id' => $this->ar->id,
        ]);
        $optedOut->notificationPreferences()->create([
            'family' => NotificationPreferences::PROJECT_AVAILABLE,
            'mail' => false,
        ]);

        Notification::fake();
        $project = $this->makeProject();

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/publish")
            ->assertOk();

        Notification::assertSentTo(
            $this->translator,
            ProjectAvailableNotification::class,
            fn (ProjectAvailableNotification $n, array $channels): bool => in_array('mail', $channels, true),
        );

        Notification::assertSentTo(
            $optedOut,
            ProjectAvailableNotification::class,
            fn (ProjectAvailableNotification $n, array $channels): bool => ! in_array('mail', $channels, true),
        );
    }
}
