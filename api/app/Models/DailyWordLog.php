<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Spatie\Activitylog\LogOptions;
use Spatie\Activitylog\Traits\LogsActivity;

class DailyWordLog extends Model
{
    use LogsActivity;

    protected $fillable = [
        'user_id',
        'work_date',
        'declared_words',
        'note',
    ];

    protected function casts(): array
    {
        return [
            'work_date' => 'date',
            'declared_words' => 'integer',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Declared numbers are self-reported, so every edit is recorded — the log is
     * what makes "he changed Tuesday from 900 to 3,900" answerable.
     */
    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()
            ->logOnly(['user_id', 'work_date', 'declared_words', 'note'])
            ->logOnlyDirty()
            ->dontSubmitEmptyLogs()
            ->useLogName('daily-words');
    }
}
