<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Assignment extends Model
{
    public const STATUS_ACTIVE = 'active';

    public const STATUS_DELIVERED = 'delivered';

    public const STATUS_WITHDRAWN = 'withdrawn';

    protected $fillable = [
        'project_id',
        'translator_id',
        'status',
        'claimed_at',
        'delivered_at',
        'work_seconds',
        'withdrawn_at',
        'withdrawn_by',
        'withdraw_reason',
    ];

    protected function casts(): array
    {
        return [
            'claimed_at' => 'datetime',
            'delivered_at' => 'datetime',
            'withdrawn_at' => 'datetime',
        ];
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    public function translator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'translator_id');
    }
}
