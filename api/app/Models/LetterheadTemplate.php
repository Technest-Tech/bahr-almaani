<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class LetterheadTemplate extends Model
{
    use HasFactory;

    public const KIND_LETTERHEAD = 'letterhead';

    public const KIND_STAMP = 'stamp';

    public const KINDS = [self::KIND_LETTERHEAD, self::KIND_STAMP];

    protected $fillable = ['name', 'kind', 'disk_path', 'preview_path', 'placement', 'is_active', 'created_by'];

    /** DB-defaulted column — without this a fresh instance returns null in resources. */
    protected $attributes = [
        'is_active' => true,
    ];

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

    /** Projects that picked this template as their letterhead (blocks deletion). */
    public function letterheadProjects(): HasMany
    {
        return $this->hasMany(Project::class, 'letterhead_id');
    }

    /** Projects that picked this template as their stamp (blocks deletion). */
    public function stampProjects(): HasMany
    {
        return $this->hasMany(Project::class, 'stamp_id');
    }

    public function isUsedByProjects(): bool
    {
        return $this->letterheadProjects()->exists() || $this->stampProjects()->exists();
    }

    public function isImage(): bool
    {
        return in_array(
            strtolower(pathinfo($this->disk_path, PATHINFO_EXTENSION)),
            ['png', 'jpg', 'jpeg'],
            true,
        );
    }

    #[Scope]
    protected function active(Builder $query): void
    {
        $query->where('is_active', true);
    }
}
