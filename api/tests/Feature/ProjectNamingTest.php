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

/**
 * The project name is optional, and the first source file supplies it.
 *
 * The office creates a project before it has any file, so an unnamed one is seeded
 * with its own code — the column is NOT NULL and twenty-five notifications, exports
 * and events print it straight — and `title_auto` marks it as still the system's to
 * replace.
 */
class ProjectNamingTest extends TestCase
{
    use RefreshDatabase;

    private User $pm;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->seed(LanguageSeeder::class);
        Storage::fake('local');

        $this->pm = User::factory()->create();
        $this->pm->syncRoles(['project_manager']);
    }

    /**
     * A project created without a name is named by its first source file.
     *
     * The project exists before any file does, so it starts life carrying its own
     * code and the first source upload replaces that.
     */
    public function test_an_unnamed_project_takes_its_name_from_the_first_source_file(): void
    {
        $project = $this->makeProject(title: null);

        $this->assertSame($project->code, $project->title, 'Seeded with the code, never blank.');
        $this->assertTrue($project->title_auto);

        $this->actingAs($this->pm, 'sanctum')->post("/api/v1/projects/{$project->id}/files", [
            'files' => [UploadedFile::fake()->createWithContent('عقد إيجار تجاري.docx', 'نص')],
            'category' => 'source',
        ])->assertCreated();

        $this->assertSame('عقد إيجار تجاري', $project->fresh()->title);
    }

    /** A name the PM typed is theirs — no upload may overwrite it. */
    public function test_a_named_project_keeps_its_name(): void
    {
        $project = $this->makeProject(title: 'ترجمة عقد الشراكة');

        $this->assertFalse($project->title_auto);

        $this->actingAs($this->pm, 'sanctum')->post("/api/v1/projects/{$project->id}/files", [
            'files' => [UploadedFile::fake()->createWithContent('random-scan-0042.pdf', 'x')],
            'category' => 'source',
        ])->assertCreated();

        $this->assertSame('ترجمة عقد الشراكة', $project->fresh()->title);
    }

    /** "First" means the first ever — page two must not rename the project. */
    public function test_a_later_upload_does_not_rename_the_project(): void
    {
        $project = $this->makeProject(title: null);

        $this->actingAs($this->pm, 'sanctum')->post("/api/v1/projects/{$project->id}/files", [
            'files' => [UploadedFile::fake()->createWithContent('صفحة ١.txt', 'أ')],
            'category' => 'source',
        ])->assertCreated();

        $this->actingAs($this->pm, 'sanctum')->post("/api/v1/projects/{$project->id}/files", [
            'files' => [UploadedFile::fake()->createWithContent('صفحة ٢.txt', 'ب')],
            'category' => 'source',
        ])->assertCreated();

        $this->assertSame('صفحة ١', $project->fresh()->title);
    }

    /** With a batch, the first file of it names the project. */
    public function test_the_first_file_of_a_batch_names_the_project(): void
    {
        $project = $this->makeProject(title: null);

        $this->actingAs($this->pm, 'sanctum')->post("/api/v1/projects/{$project->id}/files", [
            'files' => [
                UploadedFile::fake()->createWithContent('جواز السفر.txt', 'أ'),
                UploadedFile::fake()->createWithContent('الرخصة.txt', 'ب'),
            ],
            'category' => 'source',
        ])->assertCreated();

        $this->assertSame('جواز السفر', $project->fresh()->title);
    }

    /** A reference document is context, not the name of the job. */
    public function test_a_reference_document_never_names_the_project(): void
    {
        $project = $this->makeProject(title: null);

        $this->actingAs($this->pm, 'sanctum')->post("/api/v1/projects/{$project->id}/files", [
            'files' => [UploadedFile::fake()->image('الرخصة.png')],
            'category' => 'reference',
        ])->assertCreated();

        $this->assertSame($project->code, $project->fresh()->title);
    }

    public function test_creating_a_project_without_a_title_is_accepted(): void
    {
        $en = Language::where('code', 'en')->firstOrFail();
        $ar = Language::where('code', 'ar')->firstOrFail();

        $response = $this->actingAs($this->pm, 'sanctum')->postJson('/api/v1/projects', [
            'source_language_id' => $en->id,
            'target_language_id' => $ar->id,
            'service_type' => 'certified',
            'priority' => 'normal',
            'deadline_at' => now()->addDays(2)->toIso8601String(),
        ])->assertCreated();

        $this->assertSame($response->json('data.code'), $response->json('data.title'));
        $this->assertTrue($response->json('data.title_auto'));
    }

    /** Typing a name later takes ownership of it. */
    public function test_editing_the_title_stops_it_being_automatic(): void
    {
        $project = $this->makeProject(title: null);

        $this->actingAs($this->pm, 'sanctum')->putJson("/api/v1/projects/{$project->id}", [
            'title' => 'اسم من المدير',
            'source_language_id' => $project->source_language_id,
            'target_language_id' => $project->target_language_id,
            'service_type' => $project->service_type,
            'priority' => $project->priority,
            'deadline_at' => now()->addDays(3)->toIso8601String(),
        ])->assertOk();

        $fresh = $project->fresh();
        $this->assertSame('اسم من المدير', $fresh->title);
        $this->assertFalse($fresh->title_auto);
    }

    /** A draft project, named or not, created the way the API creates one. */
    private function makeProject(?string $title): Project
    {
        $en = Language::where('code', 'en')->firstOrFail();
        $ar = Language::where('code', 'ar')->firstOrFail();

        $response = $this->actingAs($this->pm, 'sanctum')->postJson('/api/v1/projects', array_filter([
            'title' => $title,
            'source_language_id' => $en->id,
            'target_language_id' => $ar->id,
            'service_type' => 'certified',
            'priority' => 'normal',
            'deadline_at' => now()->addDays(2)->toIso8601String(),
        ], fn ($value) => $value !== null))->assertCreated();

        return Project::findOrFail($response->json('data.id'));
    }
}
