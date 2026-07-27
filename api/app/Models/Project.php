<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Spatie\Activitylog\LogOptions;
use Spatie\Activitylog\Traits\LogsActivity;

class Project extends Model
{
    use LogsActivity, SoftDeletes;

    public const STATUS_DRAFT = 'draft';
    public const STATUS_AVAILABLE = 'available';
    public const STATUS_CLAIMED = 'claimed';
    public const STATUS_DELIVERED = 'delivered';
    public const STATUS_IN_REVIEW = 'in_review';
    public const STATUS_REVISION_REQUESTED = 'revision_requested';
    public const STATUS_APPROVED = 'approved';
    public const STATUS_COMPLETED = 'completed';
    public const STATUS_ARCHIVED = 'archived';
    public const STATUS_CANCELLED = 'cancelled';

    public const PRIORITY_NORMAL = 'normal';
    public const PRIORITY_URGENT = 'urgent';
    public const PRIORITY_CRITICAL = 'critical';

    /** Statuses where "late" no longer applies. */
    public const SETTLED_STATUSES = [
        self::STATUS_COMPLETED,
        self::STATUS_ARCHIVED,
        self::STATUS_CANCELLED,
    ];

    protected $fillable = [
        'code',
        'client_id',
        'title',
        'source_language_id',
        'target_language_id',
        'country_code',
        'service_type',
        'priority',
        'status',
        'declared_pages',
        'total_words',
        'total_pages',
        'deadline_at',
        'instructions',
        'quoted_amount',
        'currency',
        'letterhead_id',
        'stamp_id',
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'deadline_at' => 'datetime',
            'published_at' => 'datetime',
            'completed_at' => 'datetime',
            'cancelled_at' => 'datetime',
            'quoted_amount' => 'decimal:2',
        ];
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function sourceLanguage(): BelongsTo
    {
        return $this->belongsTo(Language::class, 'source_language_id');
    }

    public function targetLanguage(): BelongsTo
    {
        return $this->belongsTo(Language::class, 'target_language_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function files(): HasMany
    {
        return $this->hasMany(ProjectFile::class);
    }

    public function assignments(): HasMany
    {
        return $this->hasMany(Assignment::class);
    }

    public function activeAssignment(): ?Assignment
    {
        return $this->assignments()->where('status', Assignment::STATUS_ACTIVE)->first();
    }

    public function transitions(): HasMany
    {
        return $this->hasMany(StatusTransition::class)->orderBy('created_at');
    }

    public function letterhead(): BelongsTo
    {
        return $this->belongsTo(LetterheadTemplate::class, 'letterhead_id');
    }

    public function stamp(): BelongsTo
    {
        return $this->belongsTo(LetterheadTemplate::class, 'stamp_id');
    }

    /** Active translators whose language pairs match this project (portal audience). */
    public function matchingTranslators()
    {
        return User::role('translator')
            ->where('status', User::STATUS_ACTIVE)
            ->whereHas('languagePairs', fn ($q) => $q
                ->where('source_language_id', $this->source_language_id)
                ->where('target_language_id', $this->target_language_id))
            ->get();
    }

    /** Recompute cached totals from counted source files. */
    public function refreshTotals(): void
    {
        $totals = $this->files()
            ->where('category', ProjectFile::CATEGORY_SOURCE)
            ->selectRaw('COALESCE(SUM(word_count), 0) AS words, COALESCE(SUM(page_count), 0) AS pages')
            ->first();

        $this->forceFill([
            'total_words' => (int) $totals->words ?: null,
            'total_pages' => (int) $totals->pages ?: null,
        ])->saveQuietly();
    }

    public function isLate(): bool
    {
        return $this->deadline_at->isPast() && ! in_array($this->status, self::SETTLED_STATUSES, true);
    }

    #[\Illuminate\Database\Eloquent\Attributes\Scope]
    protected function late(Builder $query): void
    {
        $query->where('deadline_at', '<', now())
            ->whereNotIn('status', self::SETTLED_STATUSES);
    }

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()
            ->logOnly(['title', 'status', 'priority', 'deadline_at', 'client_id', 'quoted_amount'])
            ->logOnlyDirty()
            ->dontSubmitEmptyLogs()
            ->useLogName('projects');
    }
}
