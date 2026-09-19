<?php

namespace Tests\Feature;

use App\Models\Assignment;
use App\Models\Language;
use App\Models\LetterheadTemplate;
use App\Models\Project;
use App\Models\ProjectFile;
use App\Models\User;
use App\Services\DocumentCounter;
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
 * Per-document stamp placement — the translator drags each seal onto the blank space
 * they can actually see, and that is where the certified PDF carries it.
 *
 * The position lives on the FILE, not the project: one delivery round can be a
 * passport, a licence and a contract, and their blank space is in three places. And it
 * is kept per SEAL: a document can carry the office's seal and the sworn translator's,
 * and two seals cannot share a spot.
 */
class StampPlacementTest extends TestCase
{
    use FakesDocumentConversion, RefreshDatabase;

    private User $admin;

    private User $pm;

    private User $translator;

    /** The office seal — named to sort first, so it is the one a single-seal screen showed. */
    private LetterheadTemplate $officeSeal;

    private LetterheadTemplate $translatorSeal;

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

        $this->officeSeal = LetterheadTemplate::factory()->stamp()->create([
            'name' => 'أ — ختم المكتب',
            'created_by' => $this->admin->id,
        ]);
        $this->translatorSeal = LetterheadTemplate::factory()->stamp()->create([
            'name' => 'ب — ختم المترجم',
            'created_by' => $this->admin->id,
        ]);
    }

    public function test_the_translator_places_the_seal_and_the_delivered_file_remembers_it(): void
    {
        $project = $this->claimedProject();

        $this->actingAs($this->translator, 'sanctum')
            ->post('/api/v1/portal/deliver', [
                'files' => [UploadedFile::fake()->create('translation.docx', 12)],
                'stamp_placements' => [0 => json_encode([
                    $this->officeSeal->id => [
                        'anchor' => 'top-left',
                        'offset_x_mm' => 120.4,
                        'offset_y_mm' => 210.75,
                    ],
                ])],
            ])
            ->assertOk();

        $delivered = $project->files()->where('category', ProjectFile::CATEGORY_DELIVERABLE)->sole();

        $this->assertSame(
            [$this->officeSeal->id => ['anchor' => 'top-left', 'offset_x_mm' => 120.4, 'offset_y_mm' => 210.75]],
            $delivered->stamp_placements,
        );
        $this->assertArrayNotHasKey(
            'width_mm',
            $delivered->stamp_placements[$this->officeSeal->id],
            'Only what was dragged is stored, so the size stays the template\'s to give.',
        );
    }

    /** Two seals on one document each keep their own spot — they cannot share one. */
    public function test_each_seal_on_one_document_keeps_its_own_position(): void
    {
        $project = $this->claimedProject();

        $this->actingAs($this->translator, 'sanctum')
            ->post('/api/v1/portal/deliver', [
                'files' => [UploadedFile::fake()->create('court-ruling.docx', 12)],
                'stamp_placements' => [0 => json_encode([
                    $this->officeSeal->id => ['anchor' => 'top-left', 'offset_x_mm' => 20.5, 'offset_y_mm' => 240.5],
                    $this->translatorSeal->id => ['anchor' => 'top-left', 'offset_x_mm' => 130.5, 'offset_y_mm' => 240.5, 'pages' => 'all'],
                ])],
            ])
            ->assertOk();

        $placements = $project->files()->where('category', ProjectFile::CATEGORY_DELIVERABLE)->sole()->stamp_placements;

        $this->assertSame(20.5, $placements[$this->officeSeal->id]['offset_x_mm']);
        $this->assertSame(130.5, $placements[$this->translatorSeal->id]['offset_x_mm']);
        $this->assertSame('all', $placements[$this->translatorSeal->id]['pages']);
        $this->assertArrayNotHasKey('pages', $placements[$this->officeSeal->id]);
    }

    /**
     * A portal tab loaded before several seals were possible still sends one flat
     * position. It was dragged with the first active seal on screen, so that is the seal
     * it belongs to — dropping it would silently undo the translator's placement.
     */
    public function test_a_single_seal_position_from_an_older_screen_is_kept_for_the_seal_it_showed(): void
    {
        $project = $this->claimedProject();

        $this->actingAs($this->translator, 'sanctum')
            ->post('/api/v1/portal/deliver', [
                'files' => [UploadedFile::fake()->create('translation.docx', 12)],
                'stamp_placements' => [0 => json_encode(['anchor' => 'top-left', 'offset_x_mm' => 55.5])],
            ])
            ->assertOk();

        $this->assertSame(
            [$this->officeSeal->id => ['anchor' => 'top-left', 'offset_x_mm' => 55.5]],
            $project->files()->where('category', ProjectFile::CATEGORY_DELIVERABLE)->sole()->stamp_placements,
        );
    }

    /** Each document of a round gets its own position; they must not bleed into each other. */
    public function test_every_file_of_one_round_keeps_its_own_position(): void
    {
        $project = $this->claimedProject();
        $seal = $this->officeSeal->id;

        $this->actingAs($this->translator, 'sanctum')
            ->post('/api/v1/portal/deliver', [
                'files' => [
                    UploadedFile::fake()->create('passport.docx', 12),
                    UploadedFile::fake()->create('lease.docx', 12),
                ],
                'stamp_placements' => [
                    0 => json_encode([$seal => ['anchor' => 'top-right', 'offset_y_mm' => 40]]),
                    1 => json_encode([$seal => ['anchor' => 'bottom-left', 'offset_y_mm' => 25]]),
                ],
            ])
            ->assertOk();

        $files = $project->files()
            ->where('category', ProjectFile::CATEGORY_DELIVERABLE)
            ->orderBy('id')
            ->get();

        $this->assertSame('top-right', $files[0]->stamp_placements[$seal]['anchor']);
        $this->assertSame('bottom-left', $files[1]->stamp_placements[$seal]['anchor']);
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

        $this->assertNull($delivered->stamp_placements, 'Falls back to the stamp template.');
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
            $project->files()->where('category', ProjectFile::CATEGORY_DELIVERABLE)->sole()->stamp_placements,
        );
    }

    public function test_the_pm_can_move_the_seal_at_approval(): void
    {
        Notification::fake();
        $project = $this->approvableProject([$this->officeSeal->id => ['anchor' => 'top-left', 'offset_x_mm' => 10.0]]);
        $deliverable = $project->files()->where('category', ProjectFile::CATEGORY_DELIVERABLE)->sole();

        $this->approve($project, [
            $deliverable->id => [
                $this->officeSeal->id => ['anchor' => 'bottom-right', 'offset_x_mm' => 30.0, 'offset_y_mm' => 15.0],
            ],
        ]);

        $this->assertSame('bottom-right', $deliverable->fresh()->stamp_placements[$this->officeSeal->id]['anchor']);
    }

    /** Moving one seal leaves the other exactly where the translator put it. */
    public function test_the_pm_moving_one_seal_leaves_the_other_alone(): void
    {
        Notification::fake();
        $project = $this->approvableProject([
            $this->officeSeal->id => ['anchor' => 'top-left', 'offset_x_mm' => 10.0],
            $this->translatorSeal->id => ['anchor' => 'top-left', 'offset_x_mm' => 140.5],
        ]);
        $deliverable = $project->files()->where('category', ProjectFile::CATEGORY_DELIVERABLE)->sole();

        $this->approve($project, [
            $deliverable->id => [$this->officeSeal->id => ['anchor' => 'top-left', 'offset_x_mm' => 25.5]],
        ], [$this->officeSeal->id, $this->translatorSeal->id]);

        $placements = $deliverable->fresh()->stamp_placements;
        $this->assertSame(25.5, $placements[$this->officeSeal->id]['offset_x_mm']);
        $this->assertSame(140.5, $placements[$this->translatorSeal->id]['offset_x_mm']);
    }

    /** Clearing one is how the PM says "put this seal back where its template wants it". */
    public function test_the_pm_can_clear_one_seals_position(): void
    {
        Notification::fake();
        $project = $this->approvableProject([
            $this->officeSeal->id => ['anchor' => 'top-left', 'offset_x_mm' => 10.0],
            $this->translatorSeal->id => ['anchor' => 'top-left', 'offset_x_mm' => 140.5],
        ]);
        $deliverable = $project->files()->where('category', ProjectFile::CATEGORY_DELIVERABLE)->sole();

        $this->approve($project, [$deliverable->id => [$this->officeSeal->id => null]], [$this->officeSeal->id, $this->translatorSeal->id]);

        $this->assertSame(
            [$this->translatorSeal->id => ['anchor' => 'top-left', 'offset_x_mm' => 140.5]],
            $deliverable->fresh()->stamp_placements,
        );
    }

    /** A null for the whole file puts every seal back at its template's position. */
    public function test_the_pm_can_clear_every_position_on_a_file(): void
    {
        Notification::fake();
        $project = $this->approvableProject([$this->officeSeal->id => ['anchor' => 'top-left', 'offset_x_mm' => 10.0]]);
        $deliverable = $project->files()->where('category', ProjectFile::CATEGORY_DELIVERABLE)->sole();

        $this->approve($project, [$deliverable->id => null]);

        $this->assertNull($deliverable->fresh()->stamp_placements);
    }

    /**
     * An approval dialog loaded before several seals were possible sends one stamp_id and
     * flat positions. They belong to that one seal, so the PM's last move still lands.
     */
    public function test_an_older_approval_dialogs_single_seal_position_still_lands(): void
    {
        Notification::fake();
        $project = $this->approvableProject();
        $deliverable = $project->files()->where('category', ProjectFile::CATEGORY_DELIVERABLE)->sole();

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/review/approve", [
                'letterhead_id' => LetterheadTemplate::factory()->create(['created_by' => $this->admin->id])->id,
                'stamp_id' => $this->translatorSeal->id,
                'stamp_placements' => [$deliverable->id => ['anchor' => 'top-left', 'offset_x_mm' => 77.5]],
            ])
            ->assertOk();

        $this->assertSame([$this->translatorSeal->id], $project->fresh()->stamps->modelKeys());
        $this->assertSame(
            [$this->translatorSeal->id => ['anchor' => 'top-left', 'offset_x_mm' => 77.5]],
            $deliverable->fresh()->stamp_placements,
        );
    }

    /** Approval is the last step of a long review; a stale id must not 422 it. */
    public function test_a_file_id_from_another_project_is_ignored_not_rejected(): void
    {
        Notification::fake();
        $project = $this->approvableProject();
        $foreign = $this->approvableProject();
        $foreignFile = $foreign->files()->where('category', ProjectFile::CATEGORY_DELIVERABLE)->sole();

        $this->approve($project, [$foreignFile->id => [$this->officeSeal->id => ['anchor' => 'top-left']]]);

        $this->assertNull($foreignFile->fresh()->stamp_placements, 'Another project\'s file must not move.');
        $this->assertSame(Project::STATUS_COMPLETED, $project->fresh()->status);
    }

    /** A source file is not something the seal is stamped onto. */
    public function test_a_source_file_cannot_be_given_a_stamp_position(): void
    {
        Notification::fake();
        $project = $this->approvableProject();
        $source = $project->files()->where('category', ProjectFile::CATEGORY_SOURCE)->sole();

        $this->approve($project, [$source->id => [$this->officeSeal->id => ['anchor' => 'top-left']]]);

        $this->assertNull($source->fresh()->stamp_placements);
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

        $atTemplatePosition = $merger->mergeStoredFile('deliverables/ready.pdf', 'ready.pdf', null, [$stamp]);
        $moved = $merger->mergeStoredFile('deliverables/ready.pdf', 'ready.pdf', null, [$stamp], null, [
            $stamp->id => ['anchor' => 'top-left', 'offset_x_mm' => 15.0, 'offset_y_mm' => 15.0],
        ]);

        $this->assertStringStartsWith('%PDF-', $moved);
        $this->assertNotSame(
            $atTemplatePosition,
            $moved,
            'Moving the seal must change the page it is drawn on.',
        );
    }

    /**
     * Two seals draw two seals, each from its own position.
     *
     * Rendered bytes again: a second seal that never reached the page would leave the
     * output identical to the one-seal merge, and a position read from the wrong seal
     * would leave moving the second one without effect.
     */
    public function test_the_merge_draws_every_seal_each_at_its_own_position(): void
    {
        Storage::disk('local')->put('deliverables/ready.pdf', $this->samplePdf());

        foreach ([$this->officeSeal, $this->translatorSeal] as $seal) {
            Storage::disk('local')->put($seal->disk_path, $this->stampPng());
        }

        $merger = app(DocumentMergeService::class);
        $office = [$this->officeSeal->id => ['anchor' => 'top-left', 'offset_x_mm' => 15.0, 'offset_y_mm' => 200.0]];
        $merge = fn (array $seals, array $placements): string => $merger->mergeStoredFile(
            'deliverables/ready.pdf', 'ready.pdf', null, $seals, null, $placements,
        );

        $one = $merge([$this->officeSeal], $office);
        $two = $merge([$this->officeSeal, $this->translatorSeal], $office + [
            $this->translatorSeal->id => ['anchor' => 'top-left', 'offset_x_mm' => 120.0, 'offset_y_mm' => 200.0],
        ]);
        $secondMoved = $merge([$this->officeSeal, $this->translatorSeal], $office + [
            $this->translatorSeal->id => ['anchor' => 'top-left', 'offset_x_mm' => 120.0, 'offset_y_mm' => 30.0],
        ]);

        $this->assertNotSame($one, $two, 'The second seal must be drawn.');
        $this->assertNotSame($two, $secondMoved, 'The second seal must follow its own position.');
        $this->assertSame(
            1,
            app(DocumentCounter::class)->pdfPageCount($two),
            'Seals are drawn onto the page, never as pages of their own.',
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

    /**
     * @param  array<int, array<int, array|null>|null>  $placements  file id → stamp id → position
     * @param  list<int>|null  $stampIds  defaults to the office seal alone
     */
    private function approve(Project $project, array $placements = [], ?array $stampIds = null): void
    {
        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/review/approve", [
                'letterhead_id' => LetterheadTemplate::factory()->create(['created_by' => $this->admin->id])->id,
                'stamp_ids' => $stampIds ?? [$this->officeSeal->id],
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

    /**
     * A project in `in_review` with one deliverable, ready to approve.
     *
     * @param  array<int, array>|null  $placements  stamp id → position, as delivered
     */
    private function approvableProject(?array $placements = null): Project
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
            'stamp_placements' => $placements,
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
