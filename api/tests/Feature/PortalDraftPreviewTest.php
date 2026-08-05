<?php

namespace Tests\Feature;

use App\Models\Language;
use App\Models\LetterheadTemplate;
use App\Models\Project;
use App\Models\ProjectFile;
use App\Models\User;
use App\Services\DocumentMergeService;
use Database\Seeders\LanguageSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\Concerns\FakesDocumentConversion;
use Tests\TestCase;

/**
 * The translator's draft preview (letterhead + stamp on their own file).
 *
 * The interesting assertions are the negative ones: this must never become a
 * route to a certified document, and it must never leave anything behind that
 * looks like a delivery.
 */
class PortalDraftPreviewTest extends TestCase
{
    use FakesDocumentConversion, RefreshDatabase;

    private User $pm;

    private User $translator;

    private User $otherTranslator;

    private LetterheadTemplate $letterhead;

    private LetterheadTemplate $stamp;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->seed(LanguageSeeder::class);
        Storage::fake('local');
        $this->fakeGotenberg();

        $this->pm = User::factory()->create();
        $this->pm->syncRoles(['project_manager']);

        $this->translator = User::factory()->create();
        $this->translator->syncRoles(['translator']);

        $this->otherTranslator = User::factory()->create();
        $this->otherTranslator->syncRoles(['translator']);

        $this->letterhead = LetterheadTemplate::factory()->create(['created_by' => $this->pm->id]);
        $this->stamp = LetterheadTemplate::factory()->stamp()->create(['created_by' => $this->pm->id]);
    }

    private function heldProject(): Project
    {
        $en = Language::where('code', 'en')->firstOrFail();
        $ar = Language::where('code', 'ar')->firstOrFail();

        $project = Project::create([
            'code' => 'BM-2026-'.str_pad((string) random_int(1, 99999), 5, '0', STR_PAD_LEFT),
            'title' => 'مشروع معاينة',
            'source_language_id' => $en->id,
            'target_language_id' => $ar->id,
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
            'disk_path' => UploadedFile::fake()->createWithContent('source.txt', 'hello')
                ->store("projects/{$project->id}/source", 'local'),
            'size_bytes' => 5,
            'count_status' => ProjectFile::COUNT_DONE,
            'word_count' => 1,
        ]);

        $this->actingAs($this->translator, 'sanctum')
            ->postJson("/api/v1/portal/claim/{$project->id}")
            ->assertCreated();

        return $project;
    }

    private function upload(): UploadedFile
    {
        return UploadedFile::fake()->createWithContent('translation.pdf', $this->samplePdf(2));
    }

    public function test_translator_previews_their_file_with_letterhead_and_stamp(): void
    {
        $this->heldProject();

        $response = $this->actingAs($this->translator, 'sanctum')
            ->post('/api/v1/portal/preview', [
                'file' => $this->upload(),
                'letterhead_id' => $this->letterhead->id,
                'stamp_id' => $this->stamp->id,
            ]);

        $response->assertOk();
        $this->assertSame('application/pdf', $response->headers->get('Content-Type'));
        $this->assertStringStartsWith('%PDF', $response->getContent());
        $this->assertStringContainsString(
            'attachment; filename="draft-',
            (string) $response->headers->get('Content-Disposition'),
        );
    }

    /**
     * The watermark is the only thing stopping a draft being passed off as the
     * real document, so prove it is actually drawn rather than trusting the flag.
     * TCPDF compresses content streams, so compare against the same merge without
     * one: identical bytes would mean the watermark branch never ran.
     */
    public function test_the_draft_is_watermarked_and_the_final_file_is_not(): void
    {
        $merger = app(DocumentMergeService::class);
        $source = Storage::disk('local')->path(
            UploadedFile::fake()->createWithContent('t.pdf', $this->samplePdf(1))->store('tmp', 'local'),
        );

        $plain = $merger->merge($source, $this->letterhead, $this->stamp);
        $drafted = $merger->merge($source, $this->letterhead, $this->stamp, 'مسودة — غير معتمدة');

        $this->assertStringStartsWith('%PDF', $plain);
        $this->assertStringStartsWith('%PDF', $drafted);
        $this->assertNotSame($plain, $drafted);
        $this->assertGreaterThan(strlen($plain), strlen($drafted));
    }

    /** The whole safety story: a preview is not a delivery and not a final file. */
    public function test_preview_stores_nothing_on_the_project(): void
    {
        $project = $this->heldProject();
        $before = $project->files()->count();

        $this->actingAs($this->translator, 'sanctum')
            ->post('/api/v1/portal/preview', [
                'file' => $this->upload(),
                'letterhead_id' => $this->letterhead->id,
            ])->assertOk();

        $this->assertSame($before, $project->fresh()->files()->count());
        $this->assertDatabaseMissing('project_files', ['category' => ProjectFile::CATEGORY_FINAL]);
        $this->assertDatabaseMissing('project_files', ['category' => ProjectFile::CATEGORY_DELIVERABLE]);

        // The uploaded original is cleaned up; a preview leaves no residue.
        $this->assertEmpty(Storage::disk('local')->allFiles("previews/{$this->translator->id}"));
    }

    /** Approval, not preview, is what decides the certified file's templates. */
    public function test_preview_does_not_touch_the_projects_own_selection(): void
    {
        $project = $this->heldProject();

        $this->actingAs($this->translator, 'sanctum')
            ->post('/api/v1/portal/preview', [
                'file' => $this->upload(),
                'letterhead_id' => $this->letterhead->id,
                'stamp_id' => $this->stamp->id,
            ])->assertOk();

        $project->refresh();
        $this->assertNull($project->letterhead_id);
        $this->assertNull($project->stamp_id);
        $this->assertSame(Project::STATUS_CLAIMED, $project->status);
    }

    public function test_preview_requires_holding_a_file(): void
    {
        $this->heldProject(); // held by $this->translator, not the other one

        $this->actingAs($this->otherTranslator, 'sanctum')
            ->post('/api/v1/portal/preview', [
                'file' => $this->upload(),
                'letterhead_id' => $this->letterhead->id,
            ])->assertNotFound();
    }

    public function test_preview_needs_at_least_one_template(): void
    {
        $this->heldProject();

        $this->actingAs($this->translator, 'sanctum')
            ->post('/api/v1/portal/preview', ['file' => $this->upload()])
            ->assertStatus(422);
    }

    /** A retired template must not come back through the portal. */
    public function test_inactive_templates_are_rejected_and_hidden(): void
    {
        $this->heldProject();
        $this->letterhead->update(['is_active' => false]);

        $this->actingAs($this->translator, 'sanctum')
            ->getJson('/api/v1/portal/templates')
            ->assertOk()
            ->assertJsonMissing(['id' => $this->letterhead->id]);

        // Only an inactive letterhead named: nothing left to merge with.
        $this->actingAs($this->translator, 'sanctum')
            ->post('/api/v1/portal/preview', [
                'file' => $this->upload(),
                'letterhead_id' => $this->letterhead->id,
            ])->assertStatus(422);

        $this->actingAs($this->translator, 'sanctum')
            ->get("/api/v1/portal/templates/{$this->letterhead->id}/asset")
            ->assertNotFound();
    }

    public function test_templates_list_hides_internal_fields(): void
    {
        $this->heldProject();

        $this->actingAs($this->translator, 'sanctum')
            ->getJson('/api/v1/portal/templates')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonMissingPath('data.0.file_name')
            ->assertJsonMissingPath('data.0.created_by')
            ->assertJsonMissingPath('data.0.in_use');
    }

    public function test_a_non_translator_cannot_reach_the_preview(): void
    {
        $this->actingAs($this->pm, 'sanctum')
            ->post('/api/v1/portal/preview', [
                'file' => $this->upload(),
                'letterhead_id' => $this->letterhead->id,
            ])->assertForbidden();
    }
}
