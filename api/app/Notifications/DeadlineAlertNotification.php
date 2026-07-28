<?php

namespace App\Notifications;

use App\Models\Project;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

class DeadlineAlertNotification extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(
        public Project $project,
        public string $level, // due_soon | late
    ) {}

    public function via(object $notifiable): array
    {
        return ['database', 'mail', 'broadcast'];
    }

    public function broadcastType(): string
    {
        return $this->level === 'late' ? 'project_late' : 'project_due_soon';
    }

    public function toMail(object $notifiable): MailMessage
    {
        $deadline = $this->project->deadline_at->timezone(config('app.timezone'))->format('Y-m-d H:i');

        return $this->level === 'late'
            ? (new MailMessage)
                ->subject("⚠️ مشروع متأخر — {$this->project->code}")
                ->greeting("مرحباً {$notifiable->name}،")
                ->line("تجاوز مشروع «{$this->project->title}» موعد تسليمه ({$deadline}) ولم يكتمل بعد.")
                ->action('فتح المشروع', config('app.frontend_url')."/projects/{$this->project->id}")
            : (new MailMessage)
                ->subject("تذكير: اقتراب موعد التسليم — {$this->project->code}")
                ->greeting("مرحباً {$notifiable->name}،")
                ->line("يقترب موعد تسليم «{$this->project->title}» ({$deadline}).")
                ->action('فتح المشروع', config('app.frontend_url')."/projects/{$this->project->id}");
    }

    public function toArray(object $notifiable): array
    {
        return [
            'type' => $this->level === 'late' ? 'project_late' : 'project_due_soon',
            'project_id' => $this->project->id,
            'code' => $this->project->code,
            'message' => $this->level === 'late'
                ? "مشروع «{$this->project->title}» متأخر عن موعده"
                : "يقترب موعد تسليم «{$this->project->title}»",
        ];
    }
}
