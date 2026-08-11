<?php

namespace Tests\Feature;

use App\Models\Language;
use App\Models\Project;
use App\Models\User;
use App\Services\DocumentCounter;
use Database\Seeders\LanguageSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;
use ZipArchive;

class WordCountingTest extends TestCase
{
    use RefreshDatabase;

    private User $pm;

    private Project $project;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->seed(LanguageSeeder::class);
        Storage::fake('local');

        $this->pm = User::factory()->create();
        $this->pm->syncRoles(['project_manager']);

        $this->project = Project::create([
            'code' => 'BM-2026-00001',
            'title' => 'اختبار العد',
            'source_language_id' => Language::where('code', 'en')->first()->id,
            'target_language_id' => Language::where('code', 'ar')->first()->id,
            'service_type' => 'certified',
            'priority' => 'normal',
            'status' => Project::STATUS_DRAFT,
            'deadline_at' => now()->addDay(),
            'created_by' => $this->pm->id,
        ]);
    }

    /**
     * Characters are billed on in this market, so they are counted alongside words.
     *
     * The convention is Word's `Characters`: no spaces. Tatweel and tashkeel are
     * excluded too — they are typography, not content, and counting them would make
     * the same document cost more in Arabic than in English.
     */
    public function test_arabic_characters_exclude_spaces_tatweel_and_diacritics(): void
    {
        $counter = app(DocumentCounter::class);

        $plain = tempnam(sys_get_temp_dir(), 'txt').'.txt';
        file_put_contents($plain, 'عقد إيجار');            // 8 letters + 1 space
        $this->assertSame(8, $counter->count($plain, 'txt')['chars']);
        @unlink($plain);

        // Same nine letters, now stretched with tatweel and vowelled.
        $decorated = tempnam(sys_get_temp_dir(), 'txt').'.txt';
        file_put_contents($decorated, 'عَقــد إيجَار');
        $this->assertSame(8, $counter->count($decorated, 'txt')['chars']);
        @unlink($decorated);
    }

    public function test_a_counted_source_file_reports_characters_and_rolls_into_the_project(): void
    {
        $docx = $this->makeDocxWithChars('عقد إيجار تجاري', words: 3, pages: 1, chars: 13);

        $this->actingAs($this->pm, 'sanctum')->postJson("/api/v1/projects/{$this->project->id}/files", [
            'file' => UploadedFile::fake()->createWithContent('contract.docx', file_get_contents($docx)),
            'category' => 'source',
        ])->assertCreated();

        // The 201 is serialised before the sync-queue job writes the count, so the
        // assertion is on what was persisted — same pattern as the word-count test.
        $this->actingAs($this->pm, 'sanctum')
            ->getJson("/api/v1/projects/{$this->project->id}")
            ->assertOk()
            ->assertJsonPath('data.files.0.char_count', 13)
            ->assertJsonPath('data.total_chars', 13);

        $this->assertSame(13, $this->project->fresh()->total_chars);
    }

    public function test_manual_entry_accepts_a_character_count(): void
    {
        $file = $this->project->files()->create([
            'category' => 'source',
            'uploaded_by' => $this->pm->id,
            'original_name' => 'scan.pdf',
            'disk_path' => 'projects/1/source/scan.pdf',
            'mime_type' => 'application/pdf',
            'size_bytes' => 10,
            'count_status' => 'not_applicable',
        ]);

        $this->actingAs($this->pm, 'sanctum')
            ->putJson("/api/v1/projects/{$this->project->id}/files/{$file->id}/manual-count", [
                'char_count' => 4200,
            ])
            ->assertOk()
            ->assertJsonPath('data.char_count', 4200)
            ->assertJsonPath('data.count_source', 'manual');

        $this->assertSame(4200, $this->project->fresh()->total_chars);
    }

    /** A .docx carrying Word's own `Characters` statistic. */
    private function makeDocxWithChars(string $text, int $words, int $pages, int $chars): string
    {
        $tmp = tempnam(sys_get_temp_dir(), 'docx');
        $zip = new ZipArchive;
        $zip->open($tmp, ZipArchive::OVERWRITE);
        $zip->addFromString('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
        $zip->addFromString(
            'docProps/app.xml',
            '<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
            .'<Words>'.$words.'</Words><Pages>'.$pages.'</Pages><Characters>'.$chars.'</Characters></Properties>',
        );
        $zip->addFromString('word/document.xml', '<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>'.$text.'</w:t></w:r></w:p></w:body></w:document>');
        $zip->close();

        return $tmp;
    }

    /** Builds a real minimal .docx with Word-stamped statistics. */
    private function makeDocx(string $text, int $words, int $pages): string
    {
        $tmp = tempnam(sys_get_temp_dir(), 'docx');
        $zip = new ZipArchive;
        $zip->open($tmp, ZipArchive::OVERWRITE);
        $zip->addFromString('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
        $zip->addFromString('docProps/app.xml', '<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Words>'.$words.'</Words><Pages>'.$pages.'</Pages></Properties>');
        $zip->addFromString('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>'.htmlspecialchars($text).'</w:t></w:r></w:p></w:body></w:document>');
        $zip->close();

        $content = (string) file_get_contents($tmp);
        unlink($tmp);

        return $content;
    }

    public function test_docx_source_file_is_counted_automatically(): void
    {
        $docx = $this->makeDocx('كلمة أولى ثم كلمات أخرى كثيرة', 450, 3);

        $response = $this->actingAs($this->pm, 'sanctum')->postJson("/api/v1/projects/{$this->project->id}/files", [
            'file' => UploadedFile::fake()->createWithContent('contract.docx', $docx),
            'category' => 'source',
        ])->assertCreated();

        // QUEUE_CONNECTION=sync in tests: the job already ran.
        $this->actingAs($this->pm, 'sanctum')
            ->getJson("/api/v1/projects/{$this->project->id}")
            ->assertOk()
            ->assertJsonPath('data.files.0.word_count', 450)
            ->assertJsonPath('data.files.0.page_count', 3)
            ->assertJsonPath('data.files.0.count_status', 'done')
            ->assertJsonPath('data.total_words', 450)
            ->assertJsonPath('data.total_pages', 3);

        $this->assertIsInt($response->json('data.id'));
    }

    public function test_txt_file_words_are_counted_with_arabic_support(): void
    {
        $this->actingAs($this->pm, 'sanctum')->postJson("/api/v1/projects/{$this->project->id}/files", [
            'file' => UploadedFile::fake()->createWithContent('note.txt', 'ترجمة معتمدة لجواز السفر المرفق'),
            'category' => 'source',
        ])->assertCreated();

        $this->actingAs($this->pm, 'sanctum')
            ->getJson("/api/v1/projects/{$this->project->id}")
            ->assertJsonPath('data.files.0.word_count', 5)
            ->assertJsonPath('data.total_words', 5);
    }

    public function test_image_reference_files_are_not_counted(): void
    {
        $this->actingAs($this->pm, 'sanctum')->postJson("/api/v1/projects/{$this->project->id}/files", [
            'file' => UploadedFile::fake()->image('passport.jpg'),
            'category' => 'reference',
        ])->assertCreated()->assertJsonPath('data.count_status', 'not_applicable');

        $this->project->refresh();
        $this->assertNull($this->project->total_words);
    }

    public function test_manual_count_fallback_updates_totals(): void
    {
        // An image uploaded as SOURCE (scanned certificate) can't be auto-counted.
        $upload = $this->actingAs($this->pm, 'sanctum')->postJson("/api/v1/projects/{$this->project->id}/files", [
            'file' => UploadedFile::fake()->image('scanned-certificate.png'),
            'category' => 'source',
        ])->assertCreated();

        $fileId = $upload->json('data.id');

        $this->actingAs($this->pm, 'sanctum')
            ->getJson("/api/v1/projects/{$this->project->id}")
            ->assertJsonPath('data.files.0.count_status', 'not_applicable');

        $this->actingAs($this->pm, 'sanctum')
            ->putJson("/api/v1/projects/{$this->project->id}/files/{$fileId}/manual-count", [
                'word_count' => 320,
                'page_count' => 2,
            ])
            ->assertOk()
            ->assertJsonPath('data.count_source', 'manual')
            ->assertJsonPath('data.word_count', 320);

        $this->project->refresh();
        $this->assertSame(320, $this->project->total_words);
        $this->assertSame(2, $this->project->total_pages);
    }
}
