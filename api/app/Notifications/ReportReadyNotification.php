<?php

namespace App\Notifications;

use App\Models\ReportExport;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Notification;

/** In-app only: the exports panel is one click away, mail would be noise. */
class ReportReadyNotification extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(public ReportExport $export) {}

    public function via(object $notifiable): array
    {
        return ['database', 'broadcast'];
    }

    public function broadcastType(): string
    {
        return 'report_ready';
    }

    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'report_ready',
            'export_id' => $this->export->id,
            'message' => 'تقريرك جاهز للتحميل: '.__("reports.{$this->export->report_type}")
                .' ('.strtoupper($this->export->format).')',
        ];
    }
}
