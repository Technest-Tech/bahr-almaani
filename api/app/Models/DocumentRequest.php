<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Collection;
use Spatie\Activitylog\LogOptions;
use Spatie\Activitylog\Traits\LogsActivity;

/**
 * The office asking the client for a document a file cannot be translated without.
 *
 * The row is the system of record for the ask — not the email, which is only a
 * nudge and which today does not send at all (production MAIL_HOST is still a
 * placeholder). The client area reads the open rows and shows an upload box; the
 * PM board reads them and shows "بانتظار مستند من العميل".
 */
class DocumentRequest extends Model
{
    use LogsActivity;

    /** A national ID, passport or residence card — the name-spelling case. */
    public const KIND_IDENTITY = 'identity';

    /** Anything else the translation depends on: an old certificate, a licence. */
    public const KIND_SUPPORTING = 'supporting';

    public const KINDS = [self::KIND_IDENTITY, self::KIND_SUPPORTING];

    public const STATUS_PENDING = 'pending';

    public const STATUS_FULFILLED = 'fulfilled';

    public const STATUS_CANCELLED = 'cancelled';

    protected $attributes = [
        'kind' => self::KIND_IDENTITY,
        'status' => self::STATUS_PENDING,
    ];

    protected $fillable = [
        'project_id',
        'project_file_id',
        'kind',
        'status',
        'note',
        'requested_by',
    ];

    protected function casts(): array
    {
        return [
            'fulfilled_at' => 'datetime',
            'cancelled_at' => 'datetime',
        ];
    }

    #[Scope]
    protected function pending(Builder $query): void
    {
        $query->where('status', self::STATUS_PENDING);
    }

    public function isPending(): bool
    {
        return $this->status === self::STATUS_PENDING;
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /** The source file the missing document belongs to; null = the job as a whole. */
    public function file(): BelongsTo
    {
        return $this->belongsTo(ProjectFile::class, 'project_file_id');
    }

    public function requester(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requested_by');
    }

    /** Everything ever sent against it, superseded rounds included. */
    public function attachments(): HasMany
    {
        return $this->hasMany(ProjectFile::class, 'document_request_id')->orderBy('id');
    }

    /** What answers it *now* — plural, because an ID card has two sides. */
    public function currentAttachments(): HasMany
    {
        return $this->attachments()->current();
    }

    /**
     * Close the request against the files that answered it.
     *
     * Idempotent by design: the PM may be uploading the photo the client just sent
     * to WhatsApp at the same moment the client finally uploads it themselves, and
     * the second one through must not reopen or re-notify anything.
     */
    public function markFulfilled(): bool
    {
        if (! $this->isPending()) {
            return false;
        }

        return $this->forceFill([
            'status' => self::STATUS_FULFILLED,
            'fulfilled_at' => now(),
        ])->save();
    }

    /**
     * Ask again: the document that arrived was the wrong one.
     *
     * The same row rather than a fresh request — "the ID for this certificate" is
     * one thing the office needs, however many rounds it takes, and splitting it
     * would leave the client staring at two boxes for one document. What was sent
     * is superseded, not deleted: it stops answering the request and drops out of
     * the translator's file list, but the record of what the client handed in
     * survives. The activity log keeps each round's note.
     */
    public function reopen(string $note): void
    {
        // Refreshed first, and this is load-bearing. A caller holding an instance
        // from before the client's upload still has `status` = pending in memory;
        // forceFill would then leave that attribute clean, save would skip it, and
        // the request would keep a `fulfilled` status while claiming to be reopened.
        $this->refresh();

        $this->currentAttachments()->update(['superseded_at' => now()]);

        $this->forceFill([
            'status' => self::STATUS_PENDING,
            'note' => $note,
            'fulfilled_at' => null,
        ])->save();
    }

    /**
     * Fall back to pending when the last file answering this request is deleted.
     *
     * Called from both delete paths. A request whose answer has been removed is
     * open again by definition — otherwise the client's area would show a document
     * as received that is no longer there, and nobody would ever be asked for it.
     */
    public function reopenIfUnanswered(): bool
    {
        $this->refresh();

        if ($this->status !== self::STATUS_FULFILLED || $this->currentAttachments()->exists()) {
            return false;
        }

        return $this->forceFill([
            'status' => self::STATUS_PENDING,
            'fulfilled_at' => null,
        ])->save();
    }

    /**
     * Who hears that the client answered.
     *
     * The PM who asked, and the project's creator when that is someone else —
     * requests outlive shifts, and the person who typed the ask may be off the
     * day the scan finally arrives.
     *
     * @return Collection<int, User>
     */
    public function recipients(): Collection
    {
        return User::query()
            ->whereIn('id', array_filter([$this->requested_by, $this->project?->created_by]))
            ->where('status', User::STATUS_ACTIVE)
            // Eager-loaded because every recipient's via() consults its mail preferences.
            ->with('notificationPreferences')
            ->get();
    }

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()
            ->logOnly(['project_id', 'project_file_id', 'kind', 'status', 'note'])
            ->logOnlyDirty()
            ->dontSubmitEmptyLogs()
            ->useLogName('document_request');
    }
}
