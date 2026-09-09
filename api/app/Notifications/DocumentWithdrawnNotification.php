<?php

namespace App\Notifications;

use App\Models\Client;
use App\Models\DocumentRequest;
use App\Models\Project;
use App\Notifications\Concerns\RespectsMailPreference;
use App\Support\NotificationPreferences;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * The client removed a document they had sent — usually to replace it themselves.
 *
 * Worth telling the office about: the request has quietly reopened, and a PM who
 * downloaded that scan an hour ago is now working from a file the client has
 * withdrawn. Same preference family as the arrival — to a PM these are one topic.
 */
class DocumentWithdrawnNotification extends Notification implements ShouldQueue
{
    use Queueable, RespectsMailPreference;

    public function __construct(
        public Project $project,
        public DocumentRequest $documentRequest,
        public Client $client,
        public string $fileName,
    ) {}

    public function via(object $notifiable): array
    {
        return $this->channelsFor($notifiable, NotificationPreferences::DOCUMENT_SUPPLIED);
    }

    public function broadcastType(): string
    {
        return 'document_withdrawn';
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject("سحب العميل مستنداً — {$this->project->code}")
            ->greeting("مرحباً {$notifiable->name}،")
            ->line("حذف «{$this->client->name}» المستند «{$this->fileName}» من مشروع «{$this->project->title}».")
            ->line($this->reopened() ? 'عاد الطلب إلى «بانتظار العميل» تلقائياً.' : 'ما زال هناك مستند آخر مرفق بالطلب.')
            ->action('فتح المشروع', config('app.frontend_url')."/projects/{$this->project->id}");
    }

    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'document_withdrawn',
            'project_id' => $this->project->id,
            'code' => $this->project->code,
            'message' => "حذف «{$this->client->name}» المستند «{$this->fileName}» من مشروع «{$this->project->title}»."
                .($this->reopened() ? ' الطلب مفتوح من جديد.' : ''),
        ];
    }

    /** True when that file was the last one answering the request. */
    private function reopened(): bool
    {
        return $this->documentRequest->isPending();
    }
}
