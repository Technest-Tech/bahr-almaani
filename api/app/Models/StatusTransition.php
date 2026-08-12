<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class StatusTransition extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = ['project_id', 'from_status', 'to_status', 'actor_id', 'note'];

    protected function casts(): array
    {
        return ['created_at' => 'datetime'];
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }

    /** Files the actor attached to this transition (revision-request screenshots). */
    public function attachments(): HasMany
    {
        return $this->hasMany(ProjectFile::class, 'transition_id');
    }
}
