<?php

namespace App\Notifications;

use App\Models\Project;
use App\Notifications\Concerns\RespectsMailPreference;
use App\Support\NotificationPreferences;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/** M9b — the merge succeeded and the letterheaded final file is ready (docs/02). */
class ProjectCompletedNotification extends Notification implements ShouldQueue
{
    use Queueable, RespectsMailPreference;

    public function __construct(public Project $project) {}

    public function via(object $notifiable): array
    {
        return $this->channelsFor($notifiable, NotificationPreferences::MERGE_STATUS);
    }

    public function broadcastType(): string
    {
        return 'project_completed';
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject("اكتمل المشروع — {$this->project->code}")
            ->greeting("مرحباً {$notifiable->name}،")
            ->line("تم دمج الترويسة والختم وإصدار الملف النهائي للمشروع «{$this->project->title}».")
            ->action('تحميل الملف النهائي', config('app.frontend_url')."/projects/{$this->project->id}")
            ->line('الملف جاهز لتسليمه للعميل.');
    }

    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'project_completed',
            'project_id' => $this->project->id,
            'code' => $this->project->code,
            'message' => "جاهز للتسليم: الملف النهائي لـ «{$this->project->title}»",
        ];
    }
}
