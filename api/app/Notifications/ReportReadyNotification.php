<?php

namespace App\Notifications;

use App\Models\ReportExport;
use App\Notifications\Concerns\RespectsMailPreference;
use App\Support\NotificationPreferences;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/** Fires when an async export finishes — the download itself stays behind auth. */
class ReportReadyNotification extends Notification implements ShouldQueue
{
    use Queueable, RespectsMailPreference;

    public function __construct(public ReportExport $export) {}

    public function via(object $notifiable): array
    {
        return $this->channelsFor($notifiable, NotificationPreferences::REPORT_READY);
    }

    public function toMail(object $notifiable): MailMessage
    {
        $label = __("reports.{$this->export->report_type}");

        return (new MailMessage)
            ->subject("تقريرك جاهز — {$label}")
            ->greeting("مرحباً {$notifiable->name}،")
            ->line("اكتمل تجهيز تقرير «{$label}» بصيغة ".strtoupper($this->export->format).'.')
            ->action('فتح التقارير', config('app.frontend_url').'/reports')
            ->line('التحميل متاح من لوحة التصديرات داخل النظام.');
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
