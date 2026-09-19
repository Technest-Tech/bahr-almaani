<?php

namespace App\Notifications;

use App\Models\Client;
use App\Models\Project;
use App\Notifications\Concerns\RespectsMailPreference;
use App\Support\NotificationPreferences;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * Sent to every PM when a client starts a project from their own area. Nobody owns
 * it yet — the first PM to edit or publish the draft takes it.
 */
class ClientProjectSubmittedNotification extends Notification implements ShouldQueue
{
    use Queueable, RespectsMailPreference;

    public function __construct(
        public Project $project,
        public Client $client,
        public int $fileCount,
    ) {}

    public function via(object $notifiable): array
    {
        return $this->channelsFor($notifiable, NotificationPreferences::CLIENT_PROJECT);
    }

    /** Keep Echo's notification.type as the app-level slug (default is the FQCN). */
    public function broadcastType(): string
    {
        return 'client_project_submitted';
    }

    public function toMail(object $notifiable): MailMessage
    {
        $priority = __("quotes.priority.{$this->project->priority}");

        return (new MailMessage)
            ->subject("مشروع جديد من عميل — {$this->project->code}")
            ->greeting("مرحباً {$notifiable->name}،")
            ->line($this->message())
            ->line("الأولوية: {$priority} · عدد الملفات: {$this->fileCount}")
            ->action('فتح المشروع', config('app.frontend_url')."/projects/{$this->project->id}")
            ->line('راجِع الموعد والترويسة والختم ثم انشره للمترجمين.');
    }

    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'client_project_submitted',
            'project_id' => $this->project->id,
            'code' => $this->project->code,
            'message' => $this->message(),
        ];
    }

    private function message(): string
    {
        return "أضاف «{$this->client->name}» مشروعاً جديداً من حسابه: «{$this->project->title}» — بانتظار المراجعة والنشر.";
    }
}
