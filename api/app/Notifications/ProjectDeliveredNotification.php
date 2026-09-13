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
        /**
         * The translator changed a delivery still awaiting review. Same family as the
         * delivery itself — it is the same event for the PM, a file to review — so the
         * same mail preference governs it.
         */
        public bool $amended = false,
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
        if ($this->amended) {
            return (new MailMessage)
                ->subject("عُدِّل التسليم قبل المراجعة — {$this->project->code}")
                ->greeting("مرحباً {$notifiable->name}،")
                ->line("عدّل المترجم {$this->translator->name} ملفات تسليم المشروع «{$this->project->title}» قبل فتح المراجعة.")
                ->action('مراجعة التسليم', config('app.frontend_url')."/projects/{$this->project->id}")
                ->line('إن كنت نزّلت الملفات قبل هذا التعديل، فنزّلها من جديد.');
        }

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
            'message' => $this->amended
                ? "عدّل {$this->translator->name} تسليم «{$this->project->title}» قبل المراجعة"
                : "سلّم {$this->translator->name} ترجمة «{$this->project->title}»",
        ];
    }
}
