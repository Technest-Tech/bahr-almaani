<?php

namespace Tests\Feature;

use App\Models\Language;
use App\Models\Project;
use App\Models\User;
use App\Support\Uploads;
use Database\Seeders\LanguageSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * One upload limit, four places that have to agree on it.
 *
 * The app's rule is the only one that can answer in Arabic; nginx and PHP can
 * only refuse the body. So whenever a gate in front of the app is the lower one,
 * the translator uploads the whole file and gets an HTML 413 the app never sees —
 * which is exactly how an 82.5 MB delivery was reported as "rar files don't
 * work" on 2026-09-23. These tests fail if that ordering is ever reintroduced.
 */
class UploadLimitsTest extends TestCase
{
    use RefreshDatabase;

    private const PHP_INI = __DIR__.'/../../docker/php/php.ini';

    private const NGINX_CONF = __DIR__.'/../../docker/nginx/locations.conf';

    private const WEB_UPLOADS = __DIR__.'/../../../web/src/lib/uploads.ts';

    /** "200M" / "300m" → kilobytes. */
    private function toKilobytes(string $value): int
    {
        $number = (int) $value;

        return match (strtoupper(substr(trim($value), -1))) {
            'G' => $number * 1024 * 1024,
            'M' => $number * 1024,
            'K' => $number,
            default => (int) ($number / 1024),
        };
    }

    private function iniValue(string $key): string
    {
        $ini = file_get_contents(self::PHP_INI);
        $this->assertMatchesRegularExpression("/^{$key}\s*=\s*\S+/m", $ini, "{$key} is not set in php.ini");
        preg_match("/^{$key}\s*=\s*(\S+)/m", $ini, $matches);

        return $matches[1];
    }

    public function test_php_accepts_a_file_as_large_as_the_app_allows(): void
    {
        $this->assertGreaterThanOrEqual(
            Uploads::MAX_FILE_KB,
            $this->toKilobytes($this->iniValue('upload_max_filesize')),
            'php.ini upload_max_filesize is below the rule the app enforces.',
        );

        // The body carries a whole delivery, so it has to exceed one file.
        $this->assertGreaterThan(
            Uploads::MAX_FILE_KB,
            $this->toKilobytes($this->iniValue('post_max_size')),
            'php.ini post_max_size leaves no room for a delivery of several files.',
        );
    }

    public function test_nginx_accepts_a_body_as_large_as_php_does(): void
    {
        $conf = file_get_contents(self::NGINX_CONF);
        $this->assertSame(1, preg_match('/client_max_body_size\s+(\S+);/', $conf, $matches));

        $this->assertGreaterThanOrEqual(
            $this->toKilobytes($this->iniValue('post_max_size')),
            $this->toKilobytes($matches[1]),
            'nginx refuses bodies PHP would have accepted — the 413 the app cannot explain.',
        );
    }

    public function test_the_browser_checks_against_the_same_limit(): void
    {
        // Checked in the browser so an oversized file is refused on the spot
        // rather than after a minute of upload. A stale copy of the number there
        // is silent, hence this.
        $uploads = file_get_contents(self::WEB_UPLOADS);
        $this->assertSame(1, preg_match('/MAX_UPLOAD_KB\s*=\s*(\d+)/', $uploads, $matches));

        $this->assertSame(
            Uploads::MAX_FILE_KB,
            (int) $matches[1],
            'web/src/lib/uploads.ts no longer matches App\Support\Uploads::MAX_FILE_KB.',
        );
    }

    public function test_a_file_over_the_limit_is_refused_with_a_message(): void
    {
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->seed(LanguageSeeder::class);
        Storage::fake('local');

        $pm = User::factory()->create();
        $pm->syncRoles(['project_manager']);

        $project = Project::create([
            'code' => 'BM-2026-00001',
            'title' => 'ترجمة عقد',
            'source_language_id' => Language::where('code', 'en')->firstOrFail()->id,
            'target_language_id' => Language::where('code', 'ar')->firstOrFail()->id,
            'service_type' => 'certified',
            'priority' => 'normal',
            'status' => Project::STATUS_DRAFT,
            'deadline_at' => now()->addDays(3),
            'created_by' => $pm->id,
        ]);

        $this->actingAs($pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/files", [
                'file' => UploadedFile::fake()->create('archive.rar', Uploads::MAX_FILE_KB + 1),
                'category' => 'source',
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('files.0');

        // And one right on the limit still goes through: archives are refused for
        // their size, never for being archives.
        $this->actingAs($pm, 'sanctum')
            ->postJson("/api/v1/projects/{$project->id}/files", [
                'file' => UploadedFile::fake()->create('archive.rar', Uploads::MAX_FILE_KB),
                'category' => 'source',
            ])
            ->assertCreated();
    }
}
