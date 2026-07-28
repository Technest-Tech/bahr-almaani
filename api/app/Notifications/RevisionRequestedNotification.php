<?php

namespace App\Notifications;

use App\Models\Project;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

class RevisionRequestedNotification extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(
        public Project $project,
        public string $note,
    ) {}

    public function via(object $notifiable): array
    {
        return ['database', 'mail', 'broadcast'];
    }

    public function broadcastType(): string
    {
        return 'revision_requested';
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject("مطلوب تعديل — {$this->project->code}")
            ->greeting("مرحباً {$notifiable->name}،")
            ->line("طلب مدير المشروع تعديلاً على ترجمة «{$this->project->title}».")
            ->line("ملاحظات المراجعة: {$this->note}")
            ->action('فتح البورتال', config('app.frontend_url').'/portal')
            ->line('لن تتمكن من استلام ملفات جديدة حتى تسليم التعديل.');
    }

    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'revision_requested',
            'project_id' => $this->project->id,
            'code' => $this->project->code,
            'message' => "مطلوب تعديل على «{$this->project->title}»: {$this->note}",
        ];
    }
}
