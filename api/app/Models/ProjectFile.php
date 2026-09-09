<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

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
        'parent_file_id',
        'document_request_id',
        'category',
        'uploaded_by',
        'uploaded_by_client_id',
        'original_name',
        'disk_path',
        'mime_type',
        'size_bytes',
        'word_count',
        'page_count',
        'char_count',
        'superseded_at',
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
            'superseded_at' => 'datetime',
        ];
    }

    /**
     * What the client is allowed to see of a project's files.
     *
     * Source and final are theirs by definition — what they handed in and what they
     * get back. A `reference` file joins that list only when it answers a document
     * request, which is the office's own supporting material (internal glossaries,
     * a previous translation) staying internal while the ID the client was asked
     * for comes back visible to them.
     */
    #[Scope]
    protected function visibleToClient(Builder $query): void
    {
        $query->where(function (Builder $query): void {
            $query
                ->whereIn('category', [self::CATEGORY_SOURCE, self::CATEGORY_FINAL])
                ->orWhere(function (Builder $query): void {
                    $query
                        ->where('category', self::CATEGORY_REFERENCE)
                        ->whereNotNull('document_request_id');
                });
        });
    }

    /**
     * Files that still stand.
     *
     * A superseded supporting document is one the office rejected — the wrong ID,
     * a blurry scan. It stays on the record but stops being the answer, and above
     * all it must never reach the translator, who has no way to tell two ID cards
     * apart and would spell the name off whichever came first.
     */
    #[Scope]
    protected function current(Builder $query): void
    {
        $query->whereNull('superseded_at');
    }

    public function isSuperseded(): bool
    {
        return $this->superseded_at !== null;
    }

    public function isVisibleToClient(): bool
    {
        return in_array($this->category, [self::CATEGORY_SOURCE, self::CATEGORY_FINAL], true)
            || ($this->category === self::CATEGORY_REFERENCE && $this->document_request_id !== null);
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /** The file this one is attached to — an ID card hanging off its certificate. */
    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_file_id');
    }

    /** @return HasMany<self, $this> */
    public function attachments(): HasMany
    {
        return $this->hasMany(self::class, 'parent_file_id');
    }

    public function documentRequest(): BelongsTo
    {
        return $this->belongsTo(DocumentRequest::class);
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

    /** Set instead of `uploader` when the client supplied the file themselves. */
    public function clientUploader(): BelongsTo
    {
        return $this->belongsTo(Client::class, 'uploaded_by_client_id');
    }
}
