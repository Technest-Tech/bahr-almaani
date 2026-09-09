<?php

namespace App\Notifications;

use App\Models\DocumentRequest;
use App\Models\Project;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * "We need a document from you before we can finish this."
 *
 * Mail only, and no preference check: the recipient is a client, not a member of
 * staff, and the notification preference registry is a staff-settings screen. The
 * `document_requests` row is the system of record — the banner in the client area
 * is what the client actually acts on, and it stands whether or not this arrives.
 *
 * Note for whoever wires production mail: until MAIL_HOST stops being a
 * placeholder, this delivers nowhere and the banner is the only channel.
 */
class DocumentRequestedNotification extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(
        public Project $project,
        public DocumentRequest $documentRequest,
    ) {}

    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $kind = __("projects.document_kind.{$this->documentRequest->kind}");

        $mail = (new MailMessage)
            ->subject("مستند مطلوب — {$this->project->code}")
            ->greeting("مرحباً {$notifiable->name}،")
            ->line("لإتمام ترجمة «{$this->project->title}» نحتاج منك: **{$kind}**.");

        if ($this->documentRequest->file?->original_name) {
            $mail->line("المستند المعني: {$this->documentRequest->file->original_name}");
        }

        if ($this->documentRequest->note) {
            $mail->line($this->documentRequest->note);
        }

        return $mail
            ->action('رفع المستند', config('app.frontend_url')."/account/projects/{$this->project->id}")
            ->line('يمكنك رفع المستند من صفحة المشروع في حسابك على موقعنا.');
    }
}
