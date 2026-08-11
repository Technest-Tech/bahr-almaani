<?php

namespace Tests\Feature;

use App\Models\Assignment;
use App\Models\Language;
use App\Models\LetterheadTemplate;
use App\Models\Project;
use App\Models\ProjectFile;
use App\Models\User;
use App\Notifications\MergeFailedNotification;
use App\Notifications\ProjectCompletedNotification;
use App\Services\DocumentMergeService;
use App\Support\PlacementConfig;
use Database\Seeders\LanguageSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;
use Tests\Concerns\FakesDocumentConversion;
use Tests\TestCase;

/** M9b — the letterhead + stamp merge that produces the final deliverable. */
class LetterheadMergeTest extends TestCase
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

    public function test_approval_merges_letterhead_and_stamp_into_a_final_pdf(): void
    {
        Notification::fake();
        $project = $this->approvedProject();

        $final = $project->fresh()->files()->where('category', ProjectFile::CATEGORY_FINAL)->first();

        $this->assertNotNull($final, 'The merge should have produced a final file.');
        $this->assertSame(Project::STATUS_COMPLETED, $project->fresh()->status);
        $this->assertSame('application/pdf', $final->mime_type);
        $this->assertSame('عقد تأسيس.pdf', $final->original_name);

        // A real, parsable PDF — not an empty placeholder.
        $bytes = Storage::disk('local')->get($final->disk_path);
        $this->assertStringStartsWith('%PDF-', $bytes);
        $this->assertGreaterThan(1000, strlen($bytes));

        Notification::assertSentTo($this->pm, ProjectCompletedNotification::class);
        Notification::assertSentTo($this->admin, ProjectCompletedNotification::class);
    }

    /**
     * The client identifies a job by the filename they sent, so that is the name
     * that has to come back — not the internal project code.
     */
    public function test_the_final_file_is_named_after_the_file_the_client_sent(): void
    {
        Notification::fake();
        $project = $this->approvedProject('Lease Agreement 2026.docx');

        $final = $project->fresh()->files()->where('category', ProjectFile::CATEGORY_FINAL)->firstOrFail();

        // Extension is always .pdf — the merge rasterises through Gotenberg.
        $this->assertSame('Lease Agreement 2026.pdf', $final->original_name);

        // The stored path stays code-based: a client-supplied name never reaches the disk.
        $this->assertSame("projects/{$project->id}/final/{$project->code}-final.pdf", $final->disk_path);
    }

    public function test_a_project_with_no_source_file_falls_back_to_the_project_code(): void
    {
        Notification::fake();
        $project = $this->approvedProject(sourceName: null);

        $final = $project->fresh()->files()->where('category', ProjectFile::CATEGORY_FINAL)->firstOrFail();

        $this->assertSame("{$project->code}-final.pdf", $final->original_name);
    }

    public function test_a_path_traversal_filename_cannot_escape_the_final_directory(): void
    {
        Notification::fake();
        $project = $this->approvedProject('../../../etc/passwd.docx');

        $final = $project->fresh()->files()->where('category', ProjectFile::CATEGORY_FINAL)->firstOrFail();

        $this->assertSame("projects/{$project->id}/final/{$project->code}-final.pdf", $final->disk_path);
        $this->assertStringNotContainsString('..', $final->disk_path);
        $this->assertTrue(Storage::disk('local')->exists($final->disk_path));
    }

    public function test_the_merged_file_keeps_every_page_of_the_deliverable(): void
    {
        $this->fakeGotenberg(pages: 3);
        Notification::fake();

        $project = $this->approvedProject();
        $final = $project->fresh()->files()->where('category', ProjectFile::CATEGORY_FINAL)->firstOrFail();

        $this->assertSame(3, $this->pageCount(Storage::disk('local')->get($final->disk_path)));
    }

    public function test_merge_failure_leaves_the_project_approved_and_notifies_watchers(): void
    {
        Notification::fake();

        // A letterhead whose asset is gone is the realistic failure: someone deleted
        // the file underneath an approved project.
        $project = $this->approvableProject();
        $letterhead = LetterheadTemplate::factory()->create(['created_by' => $this->admin->id]);
        Storage::disk('local')->delete($letterhead->disk_path);

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/review/approve", [
                'letterhead_id' => $letterhead->id,
                'stamp_id' => LetterheadTemplate::factory()->stamp()->create(['created_by' => $this->admin->id])->id,
            ])
            ->assertOk();

        $project = $project->fresh();

        $this->assertSame(Project::STATUS_APPROVED, $project->status, 'A failed merge must never complete the project.');
        $this->assertNotNull($project->merge_error);
        $this->assertSame(0, $project->files()->where('category', ProjectFile::CATEGORY_FINAL)->count());

        Notification::assertSentTo($this->pm, MergeFailedNotification::class);
        Notification::assertSentTo($this->admin, MergeFailedNotification::class);
    }

    public function test_retry_reruns_the_merge_and_clears_the_error(): void
    {
        Notification::fake();
        $project = $this->approvableProject();
        $letterhead = LetterheadTemplate::factory()->create(['created_by' => $this->admin->id]);
        $assetPath = $letterhead->disk_path;
        $asset = Storage::disk('local')->get($assetPath);
        Storage::disk('local')->delete($assetPath);

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/review/approve", [
                'letterhead_id' => $letterhead->id,
                'stamp_id' => LetterheadTemplate::factory()->stamp()->create(['created_by' => $this->admin->id])->id,
            ])
            ->assertOk();

        $this->assertNotNull($project->fresh()->merge_error);

        // Put the asset back, then retry.
        Storage::disk('local')->put($assetPath, $asset);

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/merge/retry")
            ->assertOk();

        $project = $project->fresh();
        $this->assertSame(Project::STATUS_COMPLETED, $project->status);
        $this->assertNull($project->merge_error);
        $this->assertSame(2, $project->merge_attempts);
        $this->assertSame(1, $project->files()->where('category', ProjectFile::CATEGORY_FINAL)->count());
    }

    public function test_retry_is_rejected_once_the_project_has_completed(): void
    {
        Notification::fake();
        $project = $this->approvedProject();

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/merge/retry")
            ->assertStatus(422);
    }

    public function test_translator_cannot_retry_a_merge(): void
    {
        Notification::fake();
        $project = $this->approvableProject();

        $this->actingAs($this->translator, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/merge/retry")
            ->assertForbidden();
    }

    public function test_final_file_endpoint_returns_the_merged_pdf(): void
    {
        Notification::fake();
        $project = $this->approvedProject();

        $response = $this->actingAs($this->pm, 'sanctum')
            ->get("/api/v1/projects/{$project->id}/final-file")
            ->assertOk();

        $this->assertStringStartsWith('%PDF-', $response->streamedContent());
    }

    public function test_final_file_endpoint_404s_before_the_merge_runs(): void
    {
        $project = $this->approvableProject();

        $this->actingAs($this->pm, 'sanctum')
            ->getJson("/api/v1/projects/{$project->id}/final-file")
            ->assertNotFound();
    }

    public function test_preview_renders_a_specimen_merge_for_an_admin(): void
    {
        $letterhead = LetterheadTemplate::factory()->create(['created_by' => $this->admin->id]);

        $response = $this->actingAs($this->admin, 'sanctum')
            ->post("/api/v1/letterheads/{$letterhead->id}/preview")
            ->assertOk()
            ->assertHeader('Content-Type', 'application/pdf');

        $this->assertStringStartsWith('%PDF-', $response->getContent());
        $this->assertSame(2, $this->pageCount($response->getContent()));
    }

    public function test_preview_is_denied_to_a_pm(): void
    {
        $letterhead = LetterheadTemplate::factory()->create(['created_by' => $this->admin->id]);

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/letterheads/{$letterhead->id}/preview")
            ->assertForbidden();
    }

    public function test_content_band_shrinks_the_page_to_clear_the_letterhead_artwork(): void
    {
        // 33mm header + 27mm footer on A4 leaves 237mm of 297.
        $rect = PlacementConfig::resolveContentRect(
            ['content_top_mm' => 33.0, 'content_bottom_mm' => 27.0],
            210.0,
            297.0,
        );

        $this->assertEqualsWithDelta(237 / 297, $rect['scale'], 0.001);
        $this->assertEqualsWithDelta(237.0, $rect['height'], 0.01);
        $this->assertEqualsWithDelta(33.0, $rect['y'], 0.01);
        // Centred horizontally.
        $this->assertEqualsWithDelta((210 - $rect['width']) / 2, $rect['x'], 0.01);
    }

    public function test_no_content_band_leaves_the_page_at_full_size(): void
    {
        $rect = PlacementConfig::resolveContentRect(null, 210.0, 297.0);

        $this->assertSame(1.0, $rect['scale']);
        $this->assertSame(0.0, $rect['x']);
        $this->assertSame(0.0, $rect['y']);
        $this->assertSame(210.0, $rect['width']);
    }

    public function test_pdf_deliverables_skip_the_converter_entirely(): void
    {
        Http::fake(['*' => Http::response('should not be called', 500)]);

        $merger = app(DocumentMergeService::class);
        Storage::disk('local')->put('deliverables/ready.pdf', $this->samplePdf());

        $path = $merger->toPdf('deliverables/ready.pdf', 'ready.pdf');

        $this->assertStringStartsWith('%PDF-', file_get_contents($path));
        Http::assertNothingSent();
        @unlink($path);
    }

    /** An approved project whose merge has already run (the happy path). */
    private function approvedProject(?string $sourceName = 'عقد تأسيس.docx'): Project
    {
        $project = $this->approvableProject($sourceName);

        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/review/approve", [
                'letterhead_id' => LetterheadTemplate::factory()->create(['created_by' => $this->admin->id])->id,
                'stamp_id' => LetterheadTemplate::factory()->stamp()->create(['created_by' => $this->admin->id])->id,
            ])
            ->assertOk();

        return $project->fresh();
    }

    /**
     * A project sitting in `in_review` with a deliverable, ready to approve.
     *
     * @param  string|null  $sourceName  the file the client sent in; null models the
     *                                   edge case of a project with no source file at all.
     */
    private function approvableProject(?string $sourceName = 'عقد تأسيس.docx'): Project
    {
        $en = Language::where('code', 'en')->firstOrFail();
        $ar = Language::where('code', 'ar')->firstOrFail();

        $project = Project::create([
            'code' => 'BM-2026-'.str_pad((string) random_int(1, 99999), 5, '0', STR_PAD_LEFT),
            'title' => 'عقد تأسيس شركة',
            'source_language_id' => $en->id,
            'target_language_id' => $ar->id,
            'service_type' => 'certified',
            'priority' => 'normal',
            'status' => Project::STATUS_IN_REVIEW,
            'deadline_at' => now()->addDays(2),
            'created_by' => $this->pm->id,
            'published_at' => now()->subDay(),
        ]);

        if ($sourceName !== null) {
            Storage::disk('local')->put("projects/{$project->id}/source/s1.docx", 'أصل');

            $project->files()->create([
                'category' => ProjectFile::CATEGORY_SOURCE,
                'uploaded_by' => $this->pm->id,
                'original_name' => $sourceName,
                'disk_path' => "projects/{$project->id}/source/s1.docx",
                'mime_type' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'size_bytes' => 12,
                'count_status' => ProjectFile::COUNT_NOT_APPLICABLE,
            ]);
        }

        Storage::disk('local')->put("projects/{$project->id}/deliverable/v1.docx", 'ترجمة');

        $project->files()->create([
            'category' => ProjectFile::CATEGORY_DELIVERABLE,
            'uploaded_by' => $this->translator->id,
            'original_name' => 'translation.docx',
            'disk_path' => "projects/{$project->id}/deliverable/v1.docx",
            'mime_type' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'size_bytes' => 12,
            'count_status' => ProjectFile::COUNT_NOT_APPLICABLE,
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

    /** Cheap page count straight off the PDF body. */
    private function pageCount(string $pdf): int
    {
        preg_match_all('#/Type\s*/Page[^s]#', $pdf, $matches);

        return count($matches[0]);
    }
}
