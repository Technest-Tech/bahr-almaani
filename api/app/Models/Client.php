<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;
use Laravel\Scout\Searchable;
use Spatie\Activitylog\LogOptions;
use Spatie\Activitylog\Traits\LogsActivity;

/**
 * A client of the office — and, once the row carries a password, the account that
 * client signs in with on the public website (M15).
 *
 * The account lives on this row rather than in `users` deliberately: `users` is
 * the staff table that roles, assignments, workload and the translator portal all
 * read, and a client belongs to none of that. config/auth.php points the `client`
 * guard at this model, so a client's token can never satisfy `auth:sanctum` and a
 * staff token can never satisfy `auth:client` — Sanctum checks the token's
 * tokenable against the guard's provider.
 */
class Client extends Authenticatable
{
    use HasApiTokens, LogsActivity, Notifiable, Searchable, SoftDeletes;

    public const STATUS_ACTIVE = 'active';

    public const STATUS_SUSPENDED = 'suspended';

    protected $attributes = [
        'status' => self::STATUS_ACTIVE,
    ];

    protected $fillable = [
        'name', 'type', 'phone', 'email', 'notes',
        'password', 'status', 'self_registered', 'created_by',
    ];

    protected $hidden = ['password'];

    protected function casts(): array
    {
        return [
            'password' => 'hashed',
            'last_login_at' => 'datetime',
            'self_registered' => 'boolean',
        ];
    }

    /**
     * The address is the login identity, so it is stored folded and trimmed: the
     * partial unique index is on lower(email), and "Ahmad@X.com" must not become a
     * second account beside "ahmad@x.com".
     */
    protected function email(): Attribute
    {
        return Attribute::set(
            fn (?string $value): ?string => filled($value) ? mb_strtolower(trim($value)) : null,
        );
    }

    public function toSearchableArray(): array
    {
        return [
            'name' => $this->name,
            'phone' => $this->phone,
            'email' => $this->email,
            'notes' => $this->notes,
        ];
    }

    public function projects(): HasMany
    {
        return $this->hasMany(Project::class);
    }

    public function invoices(): HasMany
    {
        return $this->hasMany(Invoice::class);
    }

    public function quoteRequests(): HasMany
    {
        return $this->hasMany(QuoteRequest::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /** A row the office keeps but that nobody can sign in as has no password. */
    public function hasAccount(): bool
    {
        return filled($this->password);
    }

    public function isSuspended(): bool
    {
        return $this->status === self::STATUS_SUSPENDED;
    }

    #[Scope]
    protected function withAccount(Builder $query): void
    {
        $query->whereNotNull('password');
    }

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()
            // Never the password — not even its hash, and not the fact it changed.
            ->logOnly(['name', 'type', 'phone', 'email', 'status'])
            ->logOnlyDirty()
            ->dontSubmitEmptyLogs()
            ->useLogName('clients');
    }
}
