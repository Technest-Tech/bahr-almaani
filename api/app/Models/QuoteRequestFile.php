<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An attachment uploaded by a website visitor alongside their quote request.
 *
 * Separate from ProjectFile on purpose: these are untrusted uploads with no
 * uploader account, no word counting and no category — they are evidence for
 * pricing. On conversion they are copied into the project as source files.
 */
class QuoteRequestFile extends Model
{
    protected $fillable = [
        'quote_request_id',
        'original_name',
        'disk_path',
        'mime_type',
        'size_bytes',
    ];

    public function quoteRequest(): BelongsTo
    {
        return $this->belongsTo(QuoteRequest::class);
    }
}
