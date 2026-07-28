<?php

namespace App\Notifications;

use App\Models\Project;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Notification;

/** In-app only — sent to translators whose language pairs match a newly available project. */
class ProjectAvailableNotification extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(public Project $project) {}

    public function via(object $notifiable): array
    {
        return ['database', 'broadcast'];
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
