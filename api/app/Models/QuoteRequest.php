<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Spatie\Activitylog\LogOptions;
use Spatie\Activitylog\Traits\LogsActivity;

/**
 * A quote request submitted from the public website (M13).
 *
 * It deliberately sits OUTSIDE the project state machine: nothing here is claimable,
 * countable or assignable. A request only becomes operational work when a manager
 * converts it, which is the single point where a Project is created from it.
 */
class QuoteRequest extends Model
{
    use LogsActivity, SoftDeletes;

    /** Just arrived — nobody has looked at it yet. */
    public const STATUS_NEW = 'new';

    /** A manager picked it up and is pricing it. */
    public const STATUS_REVIEWING = 'reviewing';

    /** Priced and answered — the visitor can now see the quote on the tracking page. */
    public const STATUS_QUOTED = 'quoted';

    /** The client said yes (recorded by staff, over phone/mail). */
    public const STATUS_ACCEPTED = 'accepted';

    /** We turned it down, or the client walked away. */
    public const STATUS_DECLINED = 'declined';

    /** A project was created from it — terminal, and the link is kept. */
    public const STATUS_CONVERTED = 'converted';

    public const STATUSES = [
        self::STATUS_NEW,
        self::STATUS_REVIEWING,
        self::STATUS_QUOTED,
        self::STATUS_ACCEPTED,
        self::STATUS_DECLINED,
        self::STATUS_CONVERTED,
    ];

    /** Statuses that no longer need a manager's attention. */
    public const SETTLED_STATUSES = [
        self::STATUS_DECLINED,
        self::STATUS_CONVERTED,
    ];

    /** Statuses whose quote figures are meaningful to show the visitor. */
    public const QUOTED_STATUSES = [
        self::STATUS_QUOTED,
        self::STATUS_ACCEPTED,
        self::STATUS_CONVERTED,
    ];

    protected $fillable = [
        'reference',
        'name',
        'email',
        'phone',
        'organization',
        'title',
        'source_language_id',
        'target_language_id',
        'service_type',
        'priority',
        'declared_pages',
        'needed_by',
        'details',
        'status',
        'quoted_amount',
        'currency',
        'turnaround_days',
        'response_note',
        'responded_at',
        'responded_by',
        'client_id',
        'project_id',
        'ip_address',
        'user_agent',
    ];

    protected function casts(): array
    {
        return [
            'needed_by' => 'datetime',
            'responded_at' => 'datetime',
            'quoted_amount' => 'decimal:2',
            // Cast explicitly: Postgres hands these back as strings, and the UI
            // formats them as Arabic numerals — "14".toLocaleString() would not.
            'declared_pages' => 'integer',
            'turnaround_days' => 'integer',
        ];
    }

    public function files(): HasMany
    {
        return $this->hasMany(QuoteRequestFile::class);
    }

    public function sourceLanguage(): BelongsTo
    {
        return $this->belongsTo(Language::class, 'source_language_id');
    }

    public function targetLanguage(): BelongsTo
    {
        return $this->belongsTo(Language::class, 'target_language_id');
    }

    public function responder(): BelongsTo
    {
        return $this->belongsTo(User::class, 'responded_by');
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /** True once the visitor has an answer worth showing on the tracking page. */
    public function hasQuote(): bool
    {
        return in_array($this->status, self::QUOTED_STATUSES, true) && $this->responded_at !== null;
    }

    #[Scope]
    protected function open(Builder $query): void
    {
        $query->whereNotIn('status', self::SETTLED_STATUSES);
    }

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()
            ->logOnly(['status', 'quoted_amount', 'turnaround_days', 'priority', 'project_id'])
            ->logOnlyDirty()
            ->dontSubmitEmptyLogs()
            ->useLogName('quotes');
    }
}
