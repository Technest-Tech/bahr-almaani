<?php

namespace Database\Factories;

use App\Models\LetterheadTemplate;
use App\Models\User;
use App\Support\PlacementConfig;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Storage;

/** @extends Factory<LetterheadTemplate> */
class LetterheadTemplateFactory extends Factory
{
    protected $model = LetterheadTemplate::class;

    /**
     * Put a real PNG behind `disk_path`.
     *
     * The merge job (M9b) reads these assets for their dimensions, so a template whose
     * file does not exist is not a valid fixture — it only looked like one while the
     * finalize step still copied the deliverable verbatim.
     */
    public function configure(): static
    {
        return $this->afterCreating(function (LetterheadTemplate $template): void {
            if (Storage::disk('local')->exists($template->disk_path)) {
                return;
            }

            [$width, $height] = $template->kind === LetterheadTemplate::KIND_STAMP
                ? [180, 180]
                : [210, 297];

            Storage::disk('local')->put($template->disk_path, self::png($width, $height));
        });
    }

    /** Minimal transparent PNG with a visible mark, so getimagesize() sees real dimensions. */
    private static function png(int $width, int $height): string
    {
        $image = imagecreatetruecolor($width, $height);
        imagesavealpha($image, true);
        imagefill($image, 0, 0, imagecolorallocatealpha($image, 255, 255, 255, 127));
        imagefilledrectangle(
            $image,
            (int) ($width * 0.2),
            (int) ($height * 0.2),
            (int) ($width * 0.8),
            (int) ($height * 0.8),
            imagecolorallocate($image, 20, 60, 160),
        );

        ob_start();
        imagepng($image);
        imagedestroy($image);

        return (string) ob_get_clean();
    }

    public function definition(): array
    {
        return [
            'name' => 'ترويسة '.$this->faker->unique()->numberBetween(1, 9999),
            'kind' => LetterheadTemplate::KIND_LETTERHEAD,
            'disk_path' => 'letterheads/'.$this->faker->uuid().'.png',
            'placement' => PlacementConfig::defaultsFor(LetterheadTemplate::KIND_LETTERHEAD),
            'is_active' => true,
            'created_by' => User::factory(),
        ];
    }

    public function stamp(): static
    {
        return $this->state(fn () => [
            'name' => 'ختم '.$this->faker->unique()->numberBetween(1, 9999),
            'kind' => LetterheadTemplate::KIND_STAMP,
            'placement' => PlacementConfig::defaultsFor(LetterheadTemplate::KIND_STAMP),
        ]);
    }

    public function inactive(): static
    {
        return $this->state(fn () => ['is_active' => false]);
    }
}
