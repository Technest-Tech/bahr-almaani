<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
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

    /** Projects that picked this template as one of their seals (blocks deletion). */
    public function stampProjects(): BelongsToMany
    {
        return $this->belongsToMany(Project::class, 'project_stamps', 'stamp_id', 'project_id');
    }

    public function isUsedByProjects(): bool
    {
        return $this->letterheadProjects()->exists() || $this->stampProjects()->exists();
    }

    /**
     * The seal a single-seal screen showed by default: the first active stamp by name,
     * in the order PortalController::templates lists them. A position that arrives
     * without saying which seal it is for was dragged with this one on screen.
     */
    public static function defaultStampId(): ?int
    {
        return self::query()
            ->active()
            ->where('kind', self::KIND_STAMP)
            ->orderBy('name')
            ->orderBy('id')
            ->value('id');
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
