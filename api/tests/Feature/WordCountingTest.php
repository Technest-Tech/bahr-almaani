<?php

namespace Tests\Feature;

use App\Models\Language;
use App\Models\Project;
use App\Models\User;
use App\Services\DocumentCounter;
use App\Services\OcrCounter;
use App\Support\Tesseract;
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

    /**
     * A PDF whose Arabic extracts one letter at a time must not report letters as words.
     *
     * smalot/pdfparser reads positioned runs, and some producers place every Arabic
     * glyph separately — the extracted text comes back "خ ي ر ا ت ب" and a whitespace
     * split counts thirteen "words" for two. In production a translator's delivery of
     * roughly 1,370 words was stored as 3,227 and the office reported the counts as
     * false. Ghostscript keeps word spacing, so it is used as the second opinion.
     */
    public function test_a_pdf_that_extracts_per_glyph_is_not_counted_as_letters(): void
    {
        $counter = app(DocumentCounter::class);

        // 60 Arabic letters, each its own token — exactly what the broken extraction
        // looks like once it reaches wordCount().
        $glyphs = implode(' ', mb_str_split(str_repeat('محكمةالاستئنافبدبي', 4)));
        $this->assertTrue(
            $this->isGlyphSplit($counter, $glyphs),
            'The fixture must look glyph-split, otherwise this test proves nothing.',
        );

        // Ordinary Arabic prose must NOT trip the detector.
        $prose = 'هذه ترجمة معتمدة لعقد إيجار تجاري صادر عن محكمة دبي الابتدائية '
            .'ويشمل جميع الشروط والأحكام المتفق عليها بين الطرفين في هذا الاتفاق';
        $this->assertFalse(
            $this->isGlyphSplit($counter, $prose),
            'Normal Arabic prose was misread as glyph-split; the threshold is too tight.',
        );
    }

    /** English prose has real single-letter words ("a", "I") and must stay countable. */
    public function test_english_prose_is_not_mistaken_for_glyph_split_text(): void
    {
        $counter = app(DocumentCounter::class);
        $prose = str_repeat('I saw a cat and a dog in a house that a friend of a neighbour owns. ', 4);

        $this->assertFalse($this->isGlyphSplit($counter, $prose));
    }

    private function isGlyphSplit(DocumentCounter $counter, string $text): bool
    {
        $method = new \ReflectionMethod($counter, 'isGlyphSplit');
        $method->setAccessible(true);

        return $method->invoke($counter, $text);
    }

    /** --force re-reads automatic counts, but a typed-in number is never touched. */
    public function test_recount_force_never_overwrites_a_manual_count(): void
    {
        $file = $this->project->files()->create([
            'category' => 'source',
            'uploaded_by' => $this->pm->id,
            'original_name' => 'scan.pdf',
            'disk_path' => 'projects/1/source/scan.pdf',
            'mime_type' => 'application/pdf',
            'size_bytes' => 10,
            'word_count' => 4200,
            'count_status' => 'done',
            'count_source' => 'manual',
        ]);

        $this->artisan('files:recount', ['--force' => true])->assertSuccessful();

        $file->refresh();
        $this->assertSame(4200, $file->word_count);
        $this->assertSame('manual', $file->count_source);
    }

    /**
     * The office photographs a document page by page, so one "source" is routinely
     * several images. Uploading them one at a time was the complaint.
     */
    public function test_several_source_files_upload_in_one_request(): void
    {
        $response = $this->actingAs($this->pm, 'sanctum')->post("/api/v1/projects/{$this->project->id}/files", [
            'files' => [
                UploadedFile::fake()->createWithContent('page-1.txt', 'كلمة واحدة اثنتان'),
                UploadedFile::fake()->createWithContent('page-2.txt', 'ثلاث أربع'),
                UploadedFile::fake()->createWithContent('page-3.txt', 'خمس'),
            ],
            'category' => 'source',
        ])->assertCreated();

        $response->assertJsonCount(3, 'data');

        $files = $this->project->fresh()->files()->orderBy('id')->get();
        $this->assertSame(['page-1.txt', 'page-2.txt', 'page-3.txt'], $files->pluck('original_name')->all());
        foreach ($files as $file) {
            Storage::disk('local')->assertExists($file->disk_path);
        }

        // Each is counted, and the project total is their sum.
        $this->assertSame(6, $this->project->fresh()->total_words);
    }

    /** The old single-`file` shape still works, so nothing posting it breaks. */
    public function test_a_single_file_upload_still_works(): void
    {
        $this->actingAs($this->pm, 'sanctum')->post("/api/v1/projects/{$this->project->id}/files", [
            'file' => UploadedFile::fake()->createWithContent('one.txt', 'كلمة واحدة'),
            'category' => 'source',
        ])->assertCreated()->assertJsonCount(1, 'data');

        $this->assertSame(1, $this->project->fresh()->files()->count());
    }

    public function test_uploading_no_file_at_all_is_rejected(): void
    {
        $this->actingAs($this->pm, 'sanctum')
            ->postJson("/api/v1/projects/{$this->project->id}/files", ['category' => 'source'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('files');
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

        // store() always answers with a collection now — it accepts several files.
        $this->assertIsInt($response->json('data.0.id'));
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
        ])->assertCreated()->assertJsonPath('data.0.count_status', 'not_applicable');

        $this->project->refresh();
        $this->assertNull($this->project->total_words);
    }

    /**
     * A source with no text layer gets an OCR estimate instead of reading zero.
     *
     * The OCR service is mocked — CI has no tesseract — so this asserts the
     * wiring: the job falls back to OCR, stores the estimate as
     * count_source = 'ocr', and rolls it into the project totals.
     */
    public function test_a_scan_falls_back_to_an_ocr_estimate(): void
    {
        $this->mock(OcrCounter::class, function ($mock) {
            $mock->shouldReceive('available')->andReturn(true);
            $mock->shouldReceive('count')->once()->andReturn([
                'countable' => true,
                'words' => 412,
                'pages' => 2,
                'chars' => 2260,
            ]);
        });

        $this->actingAs($this->pm, 'sanctum')->postJson("/api/v1/projects/{$this->project->id}/files", [
            'file' => UploadedFile::fake()->image('scanned-contract.png'),
            'category' => 'source',
        ])->assertCreated();

        $this->actingAs($this->pm, 'sanctum')
            ->getJson("/api/v1/projects/{$this->project->id}")
            ->assertOk()
            ->assertJsonPath('data.files.0.word_count', 412)
            ->assertJsonPath('data.files.0.count_status', 'done')
            ->assertJsonPath('data.files.0.count_source', 'ocr')
            ->assertJsonPath('data.total_words', 412);
    }

    /** An OCR estimate survives --force: text extraction would only wipe it to nothing. */
    public function test_recount_force_keeps_an_ocr_estimate_unless_ocr_is_rerun(): void
    {
        // Content is irrelevant: a .png is uncountable without OCR, and the
        // protection branch must fire before any OCR attempt.
        Storage::disk('local')->put('projects/1/source/scan.png', 'stub');

        $file = $this->project->files()->create([
            'category' => 'source',
            'uploaded_by' => $this->pm->id,
            'original_name' => 'scan.png',
            'disk_path' => 'projects/1/source/scan.png',
            'mime_type' => 'image/png',
            'size_bytes' => 10,
            'word_count' => 500,
            'char_count' => 2700,
            'count_status' => 'done',
            'count_source' => 'ocr',
        ]);

        $this->artisan('files:recount', ['--force' => true])->assertSuccessful();

        $file->refresh();
        $this->assertSame(500, $file->word_count);
        $this->assertSame('ocr', $file->count_source);
    }

    /**
     * The real thing, end to end: a rendered image goes through tesseract and
     * comes back with a plausible word count. Skipped where tesseract or its
     * language models are not installed (CI); it runs inside the production
     * image, which carries both.
     */
    public function test_ocr_estimates_words_from_a_rendered_image(): void
    {
        if (! Tesseract::available()) {
            $this->markTestSkipped('tesseract is not installed');
        }

        $langs = (string) shell_exec(escapeshellarg((string) Tesseract::binary()).' --list-langs 2>/dev/null');

        if (! str_contains($langs, 'eng') || ! str_contains($langs, 'ara')) {
            $this->markTestSkipped('tesseract eng/ara models are not installed');
        }

        // Plain English on a white canvas — GD's bitmap font renders too small
        // for OCR, so draw at 1x and scale up 3x.
        $canvas = imagecreatetruecolor(560, 60);
        imagefill($canvas, 0, 0, (int) imagecolorallocate($canvas, 255, 255, 255));
        imagestring($canvas, 5, 12, 20, 'This is a certified translation of the attached passport', (int) imagecolorallocate($canvas, 0, 0, 0));
        $scaled = imagescale($canvas, 1680);

        $path = tempnam(sys_get_temp_dir(), 'ocr').'.png';
        imagepng($scaled !== false ? $scaled : $canvas, $path);

        try {
            $result = app(OcrCounter::class)->count($path, 'png');

            $this->assertTrue($result['countable'], 'OCR failed to read a clean rendered sentence.');
            $this->assertEqualsWithDelta(9, $result['words'], 1);
            $this->assertSame(1, $result['pages']);
        } finally {
            @unlink($path);
        }
    }

    public function test_manual_count_fallback_updates_totals(): void
    {
        // An image uploaded as SOURCE (scanned certificate) can't be auto-counted.
        $upload = $this->actingAs($this->pm, 'sanctum')->postJson("/api/v1/projects/{$this->project->id}/files", [
            'file' => UploadedFile::fake()->image('scanned-certificate.png'),
            'category' => 'source',
        ])->assertCreated();

        $fileId = $upload->json('data.0.id');

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
