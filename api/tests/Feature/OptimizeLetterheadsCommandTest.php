<?php

namespace Tests\Feature;

use App\Models\LetterheadTemplate;
use App\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class OptimizeLetterheadsCommandTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->admin = User::factory()->create()->assignRole('admin');
    }

    /**
     * A dry run has to measure what a real run would do.
     *
     * The first version copied to `<path>.probe`, and since the optimiser dispatches
     * on file extension, every template came back "no change" — a report that looked
     * like a clean bill of health while the 17 MB letterhead sat there untouched.
     */
    public function test_dry_run_reports_a_real_saving_and_writes_nothing(): void
    {
        $template = $this->templateWithOversizedAsset();
        $path = Storage::disk('local')->path($template->disk_path);
        $before = filesize($path);

        $this->artisan('letterheads:optimize', ['--dry-run' => true])
            ->assertSuccessful();

        clearstatcache(true, $path);
        $this->assertSame($before, filesize($path), 'A dry run must not touch the asset.');
        $this->assertFalse(is_file($path.'.orig'), 'A dry run must not leave a backup.');
        $this->assertEmpty(glob(dirname($path).'/*.probe*'), 'The probe copy must be cleaned up.');
    }

    public function test_a_real_run_shrinks_the_asset_and_keeps_a_restorable_backup(): void
    {
        $template = $this->templateWithOversizedAsset();
        $path = Storage::disk('local')->path($template->disk_path);
        $original = file_get_contents($path);

        $this->artisan('letterheads:optimize')->assertSuccessful();

        clearstatcache(true, $path);
        $this->assertLessThan(strlen($original), filesize($path));
        $this->assertSame($original, file_get_contents($path.'.orig'), 'The backup must be byte-exact.');

        // The client's official artwork: getting the exact original back is the
        // whole reason the backup exists.
        $this->artisan('letterheads:optimize', ['--restore' => true])->assertSuccessful();

        clearstatcache(true, $path);
        $this->assertSame($original, file_get_contents($path));
        $this->assertFalse(is_file($path.'.orig'));
    }

    public function test_a_missing_asset_is_reported_rather_than_fatal(): void
    {
        LetterheadTemplate::factory()->create([
            'created_by' => $this->admin->id,
            'disk_path' => 'letterheads/gone.png',
        ]);

        $this->artisan('letterheads:optimize', ['--dry-run' => true])->assertSuccessful();
    }

    private function templateWithOversizedAsset(): LetterheadTemplate
    {
        $relative = 'letterheads/scan.jpg';
        Storage::disk('local')->put($relative, $this->scanBytes(3400, 4800));

        return LetterheadTemplate::factory()->create([
            'created_by' => $this->admin->id,
            'disk_path' => $relative,
        ]);
    }

    private function scanBytes(int $width, int $height): string
    {
        $image = imagecreatetruecolor($width, $height);

        for ($x = 0; $x < $width; $x += 4) {
            for ($y = 0; $y < $height; $y += 4) {
                $shade = max(0, min(255, (int) (127 + 100 * sin($x / 90) * cos($y / 70)) + random_int(-35, 35)));
                imagefilledrectangle($image, $x, $y, $x + 3, $y + 3, imagecolorallocate($image, $shade, $shade, $shade));
            }
        }

        ob_start();
        imagejpeg($image, null, 100);
        imagedestroy($image);

        return (string) ob_get_clean();
    }
}
