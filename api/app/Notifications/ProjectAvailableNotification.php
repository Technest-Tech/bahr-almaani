<?php

namespace App\Notifications;

use App\Models\Project;
use App\Notifications\Concerns\RespectsMailPreference;
use App\Support\NotificationPreferences;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/** Sent to translators whose language pairs match a newly available project. */
class ProjectAvailableNotification extends Notification implements ShouldQueue
{
    use Queueable, RespectsMailPreference;

    public function __construct(public Project $project) {}

    public function via(object $notifiable): array
    {
        return $this->channelsFor($notifiable, NotificationPreferences::PROJECT_AVAILABLE);
    }

    public function toMail(object $notifiable): MailMessage
    {
        $deadline = $this->project->deadline_at?->timezone(config('app.timezone'))->format('Y-m-d H:i');

        return (new MailMessage)
            ->subject("ملف جديد متاح — {$this->project->code}")
            ->greeting("مرحباً {$notifiable->name}،")
            ->line("أصبح مشروع «{$this->project->title}» متاحاً للاستلام "
                ."({$this->project->sourceLanguage->name_ar} ← {$this->project->targetLanguage->name_ar}).")
            ->when($deadline !== null, fn (MailMessage $mail) => $mail->line("موعد التسليم: {$deadline}"))
            ->action('فتح البورتال', config('app.frontend_url').'/portal')
            ->line('الملفات تُستلم بمبدأ الأسبقية — قد يستلمه مترجم آخر قبلك.');
    }

    /** Keep Echo's notification.type as the app-level slug (default is the FQCN). */
    public function broadcastType(): string
    {
        return 'project_available';
    }

    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'project_available',
            'project_id' => $this->project->id,
            'code' => $this->project->code,
            'message' => "ملف جديد متاح: «{$this->project->title}» ({$this->project->sourceLanguage->name_ar} ← {$this->project->targetLanguage->name_ar})",
        ];
    }
}
