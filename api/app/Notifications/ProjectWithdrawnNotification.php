<?php

namespace App\Notifications;

use App\Models\Project;
use App\Notifications\Concerns\RespectsMailPreference;
use App\Support\NotificationPreferences;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

class ProjectWithdrawnNotification extends Notification implements ShouldQueue
{
    use Queueable, RespectsMailPreference;

    public function __construct(
        public Project $project,
        public string $reason,
    ) {}

    public function via(object $notifiable): array
    {
        return $this->channelsFor($notifiable, NotificationPreferences::PROJECT_WITHDRAWN);
    }

    public function broadcastType(): string
    {
        return 'project_withdrawn';
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject("تم سحب الملف — {$this->project->code}")
            ->greeting("مرحباً {$notifiable->name}،")
            ->line("سحبت الإدارة مشروع «{$this->project->title}» من قائمتك.")
            ->line("السبب: {$this->reason}")
            ->line('يمكنك الآن استلام ملفات جديدة من البورتال.');
    }

    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'project_withdrawn',
            'project_id' => $this->project->id,
            'code' => $this->project->code,
            'message' => "سُحب مشروع «{$this->project->title}» — {$this->reason}",
        ];
    }
}
