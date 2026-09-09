<?php

namespace App\Notifications;

use App\Models\DocumentRequest;
use App\Models\Project;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * "The document you sent cannot be used — please send another."
 *
 * Separate from DocumentRequestedNotification because the client has already done
 * as they were asked: the subject and the first line have to say *why* they are
 * being asked twice, or it reads as the office losing their paperwork.
 *
 * Mail only, for the same reason as the first ask — see that class. The banner in
 * the client area is the channel that works while production SMTP is a placeholder.
 */
class DocumentReplacementRequestedNotification extends Notification implements ShouldQueue
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
            ->subject("نحتاج نسخة أخرى من المستند — {$this->project->code}")
            ->greeting("مرحباً {$notifiable->name}،")
            ->line("شكراً لإرسالك المستند، لكن النسخة التي وصلتنا لا تصلح لإتمام ترجمة «{$this->project->title}».")
            ->line("**المطلوب: {$kind}**");

        if ($this->documentRequest->file?->original_name) {
            $mail->line("المستند المعني: {$this->documentRequest->file->original_name}");
        }

        if ($this->documentRequest->note) {
            $mail->line("السبب: {$this->documentRequest->note}");
        }

        return $mail
            ->action('رفع نسخة جديدة', config('app.frontend_url')."/account/projects/{$this->project->id}")
            ->line('يمكنك رفع النسخة الجديدة من صفحة المشروع في حسابك على موقعنا.');
    }
}
