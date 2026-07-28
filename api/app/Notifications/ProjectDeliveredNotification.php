<?php

namespace App\Notifications;

use App\Models\Project;
use App\Models\User;
use App\Notifications\Concerns\RespectsMailPreference;
use App\Support\NotificationPreferences;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

class ProjectDeliveredNotification extends Notification implements ShouldQueue
{
    use Queueable, RespectsMailPreference;

    public function __construct(
        public Project $project,
        public User $translator,
    ) {}

    public function via(object $notifiable): array
    {
        return $this->channelsFor($notifiable, NotificationPreferences::PROJECT_DELIVERED);
    }

    public function broadcastType(): string
    {
        return 'project_delivered';
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject("تم تسليم الترجمة — {$this->project->code}")
            ->greeting("مرحباً {$notifiable->name}،")
            ->line("سلّم المترجم {$this->translator->name} ترجمة المشروع «{$this->project->title}».")
            ->action('مراجعة التسليم', config('app.frontend_url')."/projects/{$this->project->id}")
            ->line('يمكنك فتح المراجعة واعتماد العمل أو طلب تعديل.');
    }

    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'project_delivered',
            'project_id' => $this->project->id,
            'code' => $this->project->code,
            'message' => "سلّم {$this->translator->name} ترجمة «{$this->project->title}»",
        ];
    }
}
