<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ProjectFile extends Model
{
    public const CATEGORY_SOURCE = 'source';
    public const CATEGORY_REFERENCE = 'reference';
    public const CATEGORY_DELIVERABLE = 'deliverable';
    public const CATEGORY_FINAL = 'final';

    public const COUNT_PENDING = 'pending';
    public const COUNT_PROCESSING = 'processing';
    public const COUNT_DONE = 'done';
    public const COUNT_FAILED = 'failed';
    public const COUNT_NOT_APPLICABLE = 'not_applicable';

    protected $fillable = [
        'project_id',
        'category',
        'uploaded_by',
        'original_name',
        'disk_path',
        'mime_type',
        'size_bytes',
        'word_count',
        'page_count',
        'count_status',
        'count_source',
        'version',
    ];

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    public function uploader(): BelongsTo
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }
}
