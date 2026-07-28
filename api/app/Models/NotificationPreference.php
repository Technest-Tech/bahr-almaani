<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One row per (user, notification family). A missing row means "use the family default"
 * — see App\Support\NotificationPreferences.
 */
class NotificationPreference extends Model
{
    /** DB-level default; without this a fresh instance reports null. */
    protected $attributes = [
        'mail' => true,
    ];

    protected $fillable = ['user_id', 'family', 'mail'];

    protected function casts(): array
    {
        return ['mail' => 'boolean'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
