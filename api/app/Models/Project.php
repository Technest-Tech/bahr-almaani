<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
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
     * stages carry everything they actually need to know — plus `submitted`, for a
     * project the client started themselves and the office has not published yet.
     * The office's own drafts never reach the client at all (see isClientDraft()).
     */
    public const CLIENT_STAGES = [
        self::STATUS_DRAFT => 'submitted',
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

    /**
     * The most seals one certified document can carry. Real documents carry one or
     * two; this only stops a runaway payload, never a genuine combination.
     */
    public const MAX_STAMPS = 6;

    /** Statuses where "late" no longer applies. */
    public const SETTLED_STATUSES = [
        self::STATUS_COMPLETED,
        self::STATUS_ARCHIVED,
        self::STATUS_CANCELLED,
    ];

    protected $fillable = [
        'code',
        'client_id',
        'client_submitted',
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
            'client_submitted' => 'boolean',
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

    /** @see self::CLIENT_STAGES — the office's own drafts never reach the client area. */
    public function clientStage(): string
    {
        return self::CLIENT_STAGES[$this->status] ?? 'in_progress';
    }

    /**
     * Started by the client from their own area and still waiting on the office.
     *
     * The one kind of draft a client may see — and, while it lasts, the one project
     * where the client may still change which documents are to be translated.
     */
    public function isClientDraft(): bool
    {
        return $this->client_submitted && $this->status === self::STATUS_DRAFT;
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

    /**
     * Transitions into `$status`, newest first.
     *
     * Not `transitions()->latest()`: that relation sorts oldest-first for the
     * timeline, and an ORDER BY added after it only breaks ties — so the "latest"
     * row it returned was the OLDEST one whenever two rounds were more than a second
     * apart, which in production is always. A translator on a second revision was
     * shown the first round's note, the PM's new screenshots were bound to the first
     * round, and re-delivery work time was counted from the first revision request.
     */
    public function transitionsTo(string $status): HasMany
    {
        return $this->hasMany(StatusTransition::class)
            ->where('to_status', $status)
            ->latest('created_at')
            ->latest('id');
    }

    public function letterhead(): BelongsTo
    {
        return $this->belongsTo(LetterheadTemplate::class, 'letterhead_id');
    }

    /**
     * The seals approval chose, in the order they are drawn — a later one sits over an
     * earlier one where they overlap. Empty means the final goes out unsealed.
     *
     * Several, because some documents need more than one: the office's seal and the
     * sworn translator's, or a small seal on every page and the full one on the last.
     */
    public function stamps(): BelongsToMany
    {
        return $this->belongsToMany(LetterheadTemplate::class, 'project_stamps', 'project_id', 'stamp_id')
            ->withPivot('draw_order')
            ->orderByPivot('draw_order');
    }

    /**
     * Replace the seals, drawn in the order given.
     *
     * @param  list<int>  $stampIds
     */
    public function syncStamps(array $stampIds): void
    {
        $this->stamps()->sync(
            collect(array_values($stampIds))
                ->mapWithKeys(fn (int $id, int $order): array => [$id => ['draw_order' => $order]])
                ->all(),
        );
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

    /**
     * The projects `$user` works on (client request 2026-09-19).
     *
     * A PM sees the projects they own — `created_by`, the same column that routes
     * delivery notices and deadline alerts to them — plus any nobody owns yet: a
     * client's own submission waits for whichever PM picks it up first. Holders of
     * `projects.view-all` (the admin; the accountant, for billing) see every one.
     */
    #[Scope]
    protected function visibleTo(Builder $query, User $user): void
    {
        if ($user->can('projects.view-all')) {
            return;
        }

        $query->where(fn (Builder $q) => $q
            ->where('projects.created_by', $user->id)
            ->orWhereNull('projects.created_by'));
    }

    /** @see self::visibleTo() — the same rule for a project already in hand. */
    public function isVisibleTo(User $user): bool
    {
        return $this->created_by === null
            || (int) $this->created_by === (int) $user->id
            || $user->can('projects.view-all');
    }
}
