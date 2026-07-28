<?php

namespace Database\Factories;

use App\Models\LetterheadTemplate;
use App\Models\User;
use App\Support\PlacementConfig;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<LetterheadTemplate> */
class LetterheadTemplateFactory extends Factory
{
    protected $model = LetterheadTemplate::class;

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
