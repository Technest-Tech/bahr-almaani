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

/** The client answered a document request — the file is waiting on the project. */
class DocumentSuppliedNotification extends Notification implements ShouldQueue
{
    use Queueable, RespectsMailPreference;

    public function __construct(
        public Project $project,
        public DocumentRequest $documentRequest,
        public Client $client,
        public int $fileCount,
    ) {}

    public function via(object $notifiable): array
    {
        return $this->channelsFor($notifiable, NotificationPreferences::DOCUMENT_SUPPLIED);
    }

    public function broadcastType(): string
    {
        return 'document_supplied';
    }

    public function toMail(object $notifiable): MailMessage
    {
        $kind = __("projects.document_kind.{$this->documentRequest->kind}");

        return (new MailMessage)
            ->subject("وصل مستند من العميل — {$this->project->code}")
            ->greeting("مرحباً {$notifiable->name}،")
            ->line("رفع «{$this->client->name}» المستند المطلوب ({$kind}) لمشروع «{$this->project->title}».")
            ->action('فتح المشروع', config('app.frontend_url')."/projects/{$this->project->id}");
    }

    public function toArray(object $notifiable): array
    {
        $kind = __("projects.document_kind.{$this->documentRequest->kind}");

        return [
            'type' => 'document_supplied',
            'project_id' => $this->project->id,
            'code' => $this->project->code,
            'message' => "رفع «{$this->client->name}» المستند المطلوب ({$kind}) لمشروع «{$this->project->title}».",
        ];
    }
}
