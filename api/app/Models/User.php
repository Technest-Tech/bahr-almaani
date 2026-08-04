<?php

namespace App\Models;

use App\Support\NotificationPreferences;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;
use Spatie\Activitylog\LogOptions;
use Spatie\Activitylog\Traits\LogsActivity;
use Spatie\Permission\Traits\HasRoles;

class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, HasRoles, LogsActivity, Notifiable, SoftDeletes;

    public const STATUS_ACTIVE = 'active';

    public const STATUS_SUSPENDED = 'suspended';

    /** Spatie permissions are checked against the web guard even for Sanctum token requests. */
    protected string $guard_name = 'web';

    protected $attributes = [
        'status' => self::STATUS_ACTIVE,
        'locale' => 'ar',
    ];

    protected $fillable = [
        'name',
        'email',
        'phone',
        'password',
        'status',
        'locale',
        'monthly_word_target',
    ];

    protected $hidden = [
        'password',
        'remember_token',
    ];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'last_login_at' => 'datetime',
            'password' => 'hashed',
            'monthly_word_target' => 'integer',
        ];
    }

    public function languagePairs(): HasMany
    {
        return $this->hasMany(TranslatorLanguagePair::class);
    }

    public function assignments(): HasMany
    {
        return $this->hasMany(Assignment::class, 'translator_id');
    }

    public function dailyWordLogs(): HasMany
    {
        return $this->hasMany(DailyWordLog::class);
    }

    public function notificationPreferences(): HasMany
    {
        return $this->hasMany(NotificationPreference::class);
    }

    /**
     * Should this user get the mail copy of the given notification family?
     * Rows are the override; anything unset falls back to the family default.
     */
    public function wantsMail(string $family): bool
    {
        $this->loadMissing('notificationPreferences');

        $preference = $this->notificationPreferences->firstWhere('family', $family);

        return $preference?->mail ?? NotificationPreferences::default($family);
    }

    /**
     * The full preference map (defaults merged with stored overrides) for the settings screen.
     *
     * @return array<string, bool>
     */
    public function mailPreferences(): array
    {
        $this->loadMissing('notificationPreferences');

        $stored = $this->notificationPreferences
            ->pluck('mail', 'family')
            ->only(NotificationPreferences::keys())
            ->all();

        return array_merge(NotificationPreferences::defaults(), $stored);
    }

    public function activeAssignment(): ?Assignment
    {
        return $this->assignments()->where('status', Assignment::STATUS_ACTIVE)->first();
    }

    public function isSuspended(): bool
    {
        return $this->status === self::STATUS_SUSPENDED;
    }

    #[Scope]
    protected function active(Builder $query): void
    {
        $query->where('status', self::STATUS_ACTIVE);
    }

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()
            ->logOnly(['name', 'email', 'phone', 'status', 'locale', 'monthly_word_target'])
            ->logOnlyDirty()
            ->dontSubmitEmptyLogs()
            ->useLogName('users');
    }
}
