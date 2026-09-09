<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Laravel\Scout\Searchable;
use Spatie\Activitylog\LogOptions;
use Spatie\Activitylog\Traits\LogsActivity;

class Project extends Model
{
    use LogsActivity, Searchable, SoftDeletes;

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

    /*
     * What a client is told, per internal status (M15).
     *
     * The production pipeline is the office's business: a client has no use for
     * "claimed" vs "delivered" vs "approved", and publishing it would expose who
     * is working on what and how often a file bounced back for revision. Four
     * stages carry everything they actually need to know.
     */
    public const CLIENT_STAGES = [
        self::STATUS_AVAILABLE => 'in_progress',
        self::STATUS_CLAIMED => 'in_progress',
        self::STATUS_DELIVERED => 'in_review',
        self::STATUS_IN_REVIEW => 'in_review',
        self::STATUS_REVISION_REQUESTED => 'in_review',
        self::STATUS_APPROVED => 'ready',
        self::STATUS_COMPLETED => 'completed',
        self::STATUS_ARCHIVED => 'completed',
        self::STATUS_CANCELLED => 'cancelled',
    ];

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
        'title_auto',
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
            'title_auto' => 'boolean',
        ];
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    /** The invoice this project was billed on, once it has been billed (M14). */
    public function invoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class);
    }

    /** @see self::CLIENT_STAGES — a draft never reaches the client area at all. */
    public function clientStage(): string
    {
        return self::CLIENT_STAGES[$this->status] ?? 'in_progress';
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

    /** Documents the office has asked the client for — see App\Models\DocumentRequest. */
    public function documentRequests(): HasMany
    {
        return $this->hasMany(DocumentRequest::class)->latest('id');
    }

    /**
     * Is the office waiting on the client for a document?
     *
     * Answered from whatever the caller already has: the loaded relation on the
     * detail page, the `withExists` alias on the list. The query at the end only
     * runs for the single-project responses after a mutation, which load neither.
     */
    public function awaitsDocuments(): bool
    {
        if ($this->relationLoaded('documentRequests')) {
            return $this->documentRequests->contains('status', DocumentRequest::STATUS_PENDING);
        }

        $attributes = $this->getAttributes();

        if (array_key_exists('awaiting_documents', $attributes)) {
            return (bool) $attributes['awaiting_documents'];
        }

        return $this->documentRequests()->pending()->exists();
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

    /**
     * The portal audience: every active translator.
     *
     * Was scoped to translators holding this project's language pair. The office
     * publishes to the whole team now, so the pair no longer decides who hears
     * about a file — it is a filter in the portal, not an entitlement.
     */
    public function portalTranslators()
    {
        return User::role('translator')
            ->where('status', User::STATUS_ACTIVE)
            // Eager-loaded because every recipient's via() consults its mail preferences.
            ->with('notificationPreferences')
            ->get();
    }

    /** Full-text search document (Meilisearch in dev/prod, collection engine in tests). */
    public function toSearchableArray(): array
    {
        return [
            'code' => $this->code,
            'title' => $this->title,
            'client' => $this->client?->name,
            'instructions' => $this->instructions,
        ];
    }

    protected function makeAllSearchableUsing($query)
    {
        return $query->with('client:id,name');
    }

    /**
     * The translated figure for reports: the delivered count, or the source
     * count standing in until a deliverable has been counted (and for history
     * that predates delivered totals). Interpolates only column names.
     */
    public static function deliveredSql(string $unit): string
    {
        return "COALESCE(projects.delivered_{$unit}, projects.total_{$unit})";
    }

    /** Recompute cached totals: source files (quoting) and delivered files (reporting). */
    public function refreshTotals(): void
    {
        // total_*: source only, deliberately — these totals drive the quote, and the
        // quote is priced off what the client sent, not off what the translator produced.
        $totals = $this->files()
            ->where('category', ProjectFile::CATEGORY_SOURCE)
            ->selectRaw('COALESCE(SUM(word_count), 0) AS words, COALESCE(SUM(page_count), 0) AS pages, COALESCE(SUM(char_count), 0) AS chars')
            ->first();

        // delivered_*: the newest delivery round only. A re-delivery after a revision
        // replaces its round; summing every round would bill the same document twice.
        $round = $this->files()
            ->where('category', ProjectFile::CATEGORY_DELIVERABLE)
            ->max('version');

        $delivered = $this->files()
            ->where('category', ProjectFile::CATEGORY_DELIVERABLE)
            ->where('version', $round ?? 0)
            ->selectRaw('COALESCE(SUM(word_count), 0) AS words, COALESCE(SUM(page_count), 0) AS pages, COALESCE(SUM(char_count), 0) AS chars')
            ->first();

        // Delivered pages prefer the certified final PDFs: they are what the client
        // receives, and the letterhead band repaginates, so the translator's .docx
        // can honestly disagree with the document that actually leaves the office.
        $finalPages = $this->files()
            ->where('category', ProjectFile::CATEGORY_FINAL)
            ->sum('page_count');

        $this->forceFill([
            'total_words' => (int) $totals->words ?: null,
            'total_pages' => (int) $totals->pages ?: null,
            'total_chars' => (int) $totals->chars ?: null,
            'delivered_words' => (int) $delivered->words ?: null,
            'delivered_pages' => ((int) $finalPages ?: (int) $delivered->pages) ?: null,
            'delivered_chars' => (int) $delivered->chars ?: null,
        ])->saveQuietly();
    }

    public function isLate(): bool
    {
        return $this->deadline_at->isPast() && ! in_array($this->status, self::SETTLED_STATUSES, true);
    }

    #[Scope]
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
