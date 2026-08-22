<?php

namespace Tests\Feature;

use App\Models\Assignment;
use App\Models\Language;
use App\Models\LetterheadTemplate;
use App\Models\Project;
use App\Models\ProjectFile;
use App\Models\User;
use App\Services\DocumentMergeService;
use App\Support\PlacementConfig;
use Database\Seeders\LanguageSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;
use Tests\Concerns\FakesDocumentConversion;
use Tests\TestCase;

/**
 * Per-document stamp placement — the translator drags the seal onto the blank space
 * they can actually see, and that is where the certified PDF carries it.
 *
 * The position lives on the FILE, not the project: one delivery round can be a
 * passport, a licence and a contract, and their blank space is in three places.
 */
class StampPlacementTest extends TestCase
{
    use FakesDocumentConversion, RefreshDatabase;

    private User $admin;

    private User $pm;

    private User $translator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->seed(LanguageSeeder::class);
        Storage::fake('local');
        $this->fakeGotenberg();

        $this->admin = User::factory()->create()->assignRole('admin');
        $this->pm = User::factory()->create()->assignRole('project_manager');
        $this->translator = User::factory()->create()->assignRole('translator');
    }

    public function test_the_translator_places_the_seal_and_the_delivered_file_remembers_it(): void
    {
        $project = $this->claimedProject();

        $this->actingAs($this->translator, 'sanctum')
            ->post('/api/v1/portal/deliver', [
                'files' => [UploadedFile::fake()->create('translation.docx', 12)],
                'stamp_placements' => [0 => json_encode([
                    'anchor' => 'top-left',
                    'offset_x_mm' => 120.4,
                    'offset_y_mm' => 210.75,
                ])],
            ])
            ->assertOk();

        $delivered = $project->files()->where('category', ProjectFile::CATEGORY_DELIVERABLE)->sole();

        $this->assertSame(
            ['anchor' => 'top-left', 'offset_x_mm' => 120.4, 'offset_y_mm' => 210.75],
            $delivered->stamp_placement,
        );
        $this->assertArrayNotHasKey(
            'width_mm',
            $delivered->stamp_placement,
            'No stamp template is chosen yet, so the size must stay the template\'s to give.',
        );
    }

    /** Each document of a round gets its own position; they must not bleed into each other. */
    public function test_every_file_of_one_round_keeps_its_own_position(): void
    {
        $project = $this->claimedProject();

        $this->actingAs($this->translator, 'sanctum')
            ->post('/api/v1/portal/deliver', [
                'files' => [
                    UploadedFile::fake()->create('passport.docx', 12),
                    UploadedFile::fake()->create('lease.docx', 12),
                ],
                'stamp_placements' => [
                    0 => json_encode(['anchor' => 'top-right', 'offset_y_mm' => 40]),
                    1 => json_encode(['anchor' => 'bottom-left', 'offset_y_mm' => 25]),
                ],
            ])
            ->assertOk();

        $files = $project->files()
            ->where('category', ProjectFile::CATEGORY_DELIVERABLE)
            ->orderBy('id')
            ->get();

        $this->assertSame('top-right', $files[0]->stamp_placement['anchor']);
        $this->assertSame('bottom-left', $files[1]->stamp_placement['anchor']);
    }

    /** A delivery must never fail because the optional position riding with it was junk. */
    public function test_a_malformed_position_is_dropped_and_the_delivery_still_lands(): void
    {
        $project = $this->claimedProject();

        $this->actingAs($this->translator, 'sanctum')
            ->post('/api/v1/portal/deliver', [
                'files' => [UploadedFile::fake()->create('translation.docx', 12)],
                'stamp_placements' => [0 => 'not json at all'],
            ])
            ->assertOk();

        $delivered = $project->files()->where('category', ProjectFile::CATEGORY_DELIVERABLE)->sole();

        $this->assertNull($delivered->stamp_placement, 'Falls back to the stamp template.');
        $this->assertSame(Project::STATUS_DELIVERED, $project->fresh()->status);
    }

    /** Delivering without touching the seal leaves the template in charge, as before. */
    public function test_a_delivery_that_never_placed_a_seal_is_unchanged(): void
    {
        $project = $this->claimedProject();

        $this->actingAs($this->translator, 'sanctum')
            ->post('/api/v1/portal/deliver', [
                'files' => [UploadedFile::fake()->create('translation.docx', 12)],
            ])
            ->assertOk();

        $this->assertNull(
            $project->files()->where('category', ProjectFile::CATEGORY_DELIVERABLE)->sole()->stamp_placement,
        );
    }

    public function test_the_pm_can_move_the_seal_at_approval(): void
    {
        Notification::fake();
        $project = $this->approvableProject(['anchor' => 'top-left', 'offset_x_mm' => 10.0]);
        $deliverable = $project->files()->where('category', ProjectFile::CATEGORY_DELIVERABLE)->sole();

        $this->approve($project, [
            $deliverable->id => ['anchor' => 'bottom-right', 'offset_x_mm' => 30.0, 'offset_y_mm' => 15.0],
        ]);

        $this->assertSame('bottom-right', $deliverable->fresh()->stamp_placement['anchor']);
    }

    /** Clearing it is how the PM says "put it back where the stamp template wants it". */
    public function test_the_pm_can_clear_the_translators_position(): void
    {
        Notification::fake();
        $project = $this->approvableProject(['anchor' => 'top-left', 'offset_x_mm' => 10.0]);
        $deliverable = $project->files()->where('category', ProjectFile::CATEGORY_DELIVERABLE)->sole();

        $this->approve($project, [$deliverable->id => null]);

        $this->assertNull($deliverable->fresh()->stamp_placement);
    }

    /** Approval is the last step of a long review; a stale id must not 422 it. */
    public function test_a_file_id_from_another_project_is_ignored_not_rejected(): void
    {
        Notification::fake();
        $project = $this->approvableProject();
        $foreign = $this->approvableProject();
        $foreignFile = $foreign->files()->where('category', ProjectFile::CATEGORY_DELIVERABLE)->sole();

        $this->approve($project, [$foreignFile->id => ['anchor' => 'top-left']]);

        $this->assertNull($foreignFile->fresh()->stamp_placement, 'Another project\'s file must not move.');
        $this->assertSame(Project::STATUS_COMPLETED, $project->fresh()->status);
    }

    /** A source file is not something the seal is stamped onto. */
    public function test_a_source_file_cannot_be_given_a_stamp_position(): void
    {
        Notification::fake();
        $project = $this->approvableProject();
        $source = $project->files()->where('category', ProjectFile::CATEGORY_SOURCE)->sole();

        $this->approve($project, [$source->id => ['anchor' => 'top-left']]);

        $this->assertNull($source->fresh()->stamp_placement);
    }

    /**
     * The whole point: a different position must produce a different certified page.
     *
     * Asserted on the rendered bytes rather than on the geometry helpers — those are
     * unit-tested — so this fails if the placement ever stops reaching the draw call.
     */
    public function test_the_merge_draws_the_seal_where_the_document_says(): void
    {
        Storage::disk('local')->put('deliverables/ready.pdf', $this->samplePdf());

        $stamp = LetterheadTemplate::factory()->stamp()->create(['created_by' => $this->admin->id]);
        Storage::disk('local')->put($stamp->disk_path, $this->stampPng());

        $merger = app(DocumentMergeService::class);

        $atTemplatePosition = $merger->mergeStoredFile('deliverables/ready.pdf', 'ready.pdf', null, $stamp);
        $moved = $merger->mergeStoredFile('deliverables/ready.pdf', 'ready.pdf', null, $stamp, null, [
            'anchor' => 'top-left',
            'offset_x_mm' => 15.0,
            'offset_y_mm' => 15.0,
        ]);

        $this->assertStringStartsWith('%PDF-', $moved);
        $this->assertNotSame(
            $atTemplatePosition,
            $moved,
            'Moving the seal must change the page it is drawn on.',
        );
    }

    /** The document's position overrides the template's without resizing the seal. */
    public function test_a_dragged_position_does_not_resize_the_seal(): void
    {
        $template = PlacementConfig::normalize(['width_mm' => 174.5], 'stamp');

        $resolved = PlacementConfig::normalize(
            ['anchor' => 'top-left', 'offset_x_mm' => 15.0],
            'stamp',
            $template,
        );

        $this->assertSame(174.5, $resolved['width_mm']);
    }

    /** A translator may only place a seal on the project they are holding. */
    public function test_the_stamp_surface_is_refused_to_a_translator_holding_nothing(): void
    {
        $this->actingAs($this->translator, 'sanctum')
            ->post('/api/v1/portal/stamp-surface', [
                'file' => UploadedFile::fake()->create('translation.docx', 12),
            ])
            ->assertNotFound();
    }

    public function test_the_pm_stamp_surface_refuses_a_file_from_another_project(): void
    {
        $project = $this->approvableProject();
        $foreign = $this->approvableProject();
        $foreignFile = $foreign->files()->where('category', ProjectFile::CATEGORY_DELIVERABLE)->sole();

        $this->actingAs($this->pm, 'sanctum')
            ->getJson("/api/v1/projects/{$project->id}/files/{$foreignFile->id}/stamp-surface")
            ->assertNotFound();
    }

    public function test_the_pm_stamp_surface_refuses_a_source_file(): void
    {
        $project = $this->approvableProject();
        $source = $project->files()->where('category', ProjectFile::CATEGORY_SOURCE)->sole();

        $this->actingAs($this->pm, 'sanctum')
            ->getJson("/api/v1/projects/{$project->id}/files/{$source->id}/stamp-surface")
            ->assertNotFound();
    }

    public function test_a_translator_cannot_reach_the_pms_stamp_surface(): void
    {
        $project = $this->approvableProject();
        $deliverable = $project->files()->where('category', ProjectFile::CATEGORY_DELIVERABLE)->sole();

        $this->actingAs($this->translator, 'sanctum')
            ->getJson("/api/v1/projects/{$project->id}/files/{$deliverable->id}/stamp-surface")
            ->assertForbidden();
    }

    /** @param  array<int, array|null>  $placements */
    private function approve(Project $project, array $placements = []): void
    {
        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/review/approve", [
                'letterhead_id' => LetterheadTemplate::factory()->create(['created_by' => $this->admin->id])->id,
                'stamp_id' => LetterheadTemplate::factory()->stamp()->create(['created_by' => $this->admin->id])->id,
                'stamp_placements' => $placements,
            ])
            ->assertOk();
    }

    /** A project the translator is holding, ready to deliver. */
    private function claimedProject(): Project
    {
        $project = $this->makeProject(Project::STATUS_CLAIMED);

        $project->assignments()->create([
            'translator_id' => $this->translator->id,
            'status' => Assignment::STATUS_ACTIVE,
            'claimed_at' => now()->subHour(),
        ]);

        return $project;
    }

    /** A project in `in_review` with one deliverable, ready to approve. */
    private function approvableProject(?array $placement = null): Project
    {
        $project = $this->makeProject(Project::STATUS_IN_REVIEW);

        Storage::disk('local')->put("projects/{$project->id}/source/s1.docx", 'أصل');
        $project->files()->create([
            'category' => ProjectFile::CATEGORY_SOURCE,
            'uploaded_by' => $this->pm->id,
            'original_name' => 'source.docx',
            'disk_path' => "projects/{$project->id}/source/s1.docx",
            'mime_type' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'size_bytes' => 12,
            'count_status' => ProjectFile::COUNT_NOT_APPLICABLE,
        ]);

        Storage::disk('local')->put("projects/{$project->id}/deliverable/v1.docx", 'ترجمة');
        $project->files()->create([
            'category' => ProjectFile::CATEGORY_DELIVERABLE,
            'uploaded_by' => $this->translator->id,
            'original_name' => 'translation.docx',
            'disk_path' => "projects/{$project->id}/deliverable/v1.docx",
            'mime_type' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'size_bytes' => 12,
            'count_status' => ProjectFile::COUNT_NOT_APPLICABLE,
            'stamp_placement' => $placement,
        ]);

        $project->assignments()->create([
            'translator_id' => $this->translator->id,
            'status' => Assignment::STATUS_DELIVERED,
            'claimed_at' => now()->subHour(),
            'delivered_at' => now(),
            'work_seconds' => 3600,
        ]);

        return $project;
    }

    private function makeProject(string $status): Project
    {
        return Project::create([
            'code' => 'BM-2026-'.str_pad((string) random_int(1, 99999), 5, '0', STR_PAD_LEFT),
            'title' => 'عقد إيجار مستودع',
            'source_language_id' => Language::where('code', 'en')->firstOrFail()->id,
            'target_language_id' => Language::where('code', 'ar')->firstOrFail()->id,
            'service_type' => 'certified',
            'priority' => 'normal',
            'status' => $status,
            'deadline_at' => now()->addDays(2),
            'created_by' => $this->pm->id,
            'published_at' => now()->subDay(),
        ]);
    }

    /** A small opaque square — enough for the merge to have something to draw. */
    private function stampPng(): string
    {
        $image = imagecreatetruecolor(120, 120);
        imagefill($image, 0, 0, imagecolorallocate($image, 190, 30, 45));
        ob_start();
        imagepng($image);
        imagedestroy($image);

        return (string) ob_get_clean();
    }
}
