<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Spatie\Activitylog\LogOptions;
use Spatie\Activitylog\Traits\LogsActivity;

class Invoice extends Model
{
    use LogsActivity;

    protected $fillable = [
        'number',
        'client_id',
        'total_pages',
        'total_words',
        'unit_price',
        'amount',
        'currency',
        'notes',
        'line_items',
        'disk_path',
        'created_by',
        'issued_at',
    ];

    protected function casts(): array
    {
        return [
            // The billed projects as they stood at issue: an invoice is a
            // historical document, so its rows never follow later edits.
            'line_items' => 'array',
            'unit_price' => 'decimal:2',
            'amount' => 'decimal:2',
            'issued_at' => 'datetime',
        ];
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function projects(): HasMany
    {
        return $this->hasMany(Project::class);
    }

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()
            // total_pages and unit_price joined the list when invoices became
            // editable (2026-09-07): a corrected rate or a changed billed set has
            // to leave a trail, not just a new amount.
            ->logOnly(['number', 'client_id', 'total_pages', 'unit_price', 'amount', 'currency'])
            ->logOnlyDirty()
            ->dontSubmitEmptyLogs()
            ->useLogName('invoices');
    }
}
