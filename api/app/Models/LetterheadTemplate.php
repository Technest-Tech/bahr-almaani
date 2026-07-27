<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LetterheadTemplate extends Model
{
    public const KIND_LETTERHEAD = 'letterhead';

    public const KIND_STAMP = 'stamp';

    protected $fillable = ['name', 'kind', 'disk_path', 'preview_path', 'placement', 'is_active', 'created_by'];

    protected function casts(): array
    {
        return [
            'placement' => 'array',
            'is_active' => 'boolean',
        ];
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    #[\Illuminate\Database\Eloquent\Attributes\Scope]
    protected function active(Builder $query): void
    {
        $query->where('is_active', true);
    }
}
