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

    /** Screenshots the PM attaches when sending work back — see the transition relation. */
    public const CATEGORY_REVISION = 'revision';

    public const COUNT_PENDING = 'pending';

    public const COUNT_PROCESSING = 'processing';

    public const COUNT_DONE = 'done';

    public const COUNT_FAILED = 'failed';

    public const COUNT_NOT_APPLICABLE = 'not_applicable';

    protected $attributes = [
        'count_status' => self::COUNT_PENDING,
        'count_source' => 'auto',
        'version' => 1,
    ];

    protected $fillable = [
        'project_id',
        'transition_id',
        'category',
        'uploaded_by',
        'original_name',
        'disk_path',
        'mime_type',
        'size_bytes',
        'word_count',
        'page_count',
        'char_count',
        'count_status',
        'count_source',
        'version',
        'stamp_placement',
    ];

    protected function casts(): array
    {
        return [
            // Deliverables only: where this document's stamp goes, normalized by
            // App\Support\PlacementConfig. Null = the stamp template's own position.
            'stamp_placement' => 'array',
        ];
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /** Set only on revision attachments: which round of feedback this belongs to. */
    public function transition(): BelongsTo
    {
        return $this->belongsTo(StatusTransition::class, 'transition_id');
    }

    public function uploader(): BelongsTo
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }
}
