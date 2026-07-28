<?php

namespace App\Notifications;

use App\Models\Project;
use App\Notifications\Concerns\RespectsMailPreference;
use App\Support\NotificationPreferences;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;
use Illuminate\Support\Str;

/**
 * M9b — the merge failed; the project is still `approved` and awaiting a retry.
 *
 * Carries the error text because the PM's first question is always "why", and the
 * answer decides whether they retry or fix the template.
 */
class MergeFailedNotification extends Notification implements ShouldQueue
{
    use Queueable, RespectsMailPreference;

    public function __construct(
        public Project $project,
        public string $reason,
    ) {}

    public function via(object $notifiable): array
    {
        return $this->channelsFor($notifiable, NotificationPreferences::MERGE_STATUS);
    }

    public function broadcastType(): string
    {
        return 'merge_failed';
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->error()
            ->subject("فشل دمج الترويسة — {$this->project->code}")
            ->greeting("مرحباً {$notifiable->name}،")
            ->line("تعذّر إصدار الملف النهائي للمشروع «{$this->project->title}».")
            ->line('السبب: '.Str::limit($this->reason, 300))
            ->action('إعادة المحاولة', config('app.frontend_url')."/projects/{$this->project->id}")
            ->line('المشروع ما زال في حالة «معتمد» ولم يكتمل — يمكنك إعادة المحاولة بعد المراجعة.');
    }

    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'merge_failed',
            'project_id' => $this->project->id,
            'code' => $this->project->code,
            'reason' => Str::limit($this->reason, 300),
            'message' => "فشل دمج الترويسة لـ «{$this->project->title}»",
        ];
    }
}
