<?php

namespace App\Notifications;

use App\Models\QuoteRequest;
use App\Notifications\Concerns\RespectsMailPreference;
use App\Support\NotificationPreferences;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/** Sent to staff who handle quotes when the public website receives a new request. */
class QuoteRequestReceivedNotification extends Notification implements ShouldQueue
{
    use Queueable, RespectsMailPreference;

    public function __construct(public QuoteRequest $quote) {}

    public function via(object $notifiable): array
    {
        return $this->channelsFor($notifiable, NotificationPreferences::QUOTE_RECEIVED);
    }

    public function toMail(object $notifiable): MailMessage
    {
        $priority = __("quotes.priority.{$this->quote->priority}");

        return (new MailMessage)
            ->subject("طلب تسعير جديد — {$this->quote->reference}")
            ->greeting("مرحباً {$notifiable->name}،")
            ->line("وصل طلب تسعير جديد من «{$this->quote->name}»: {$this->quote->title}")
            ->line("الأولوية: {$priority} · عدد المرفقات: {$this->quote->files()->count()}")
            ->action('فتح الطلب', config('app.frontend_url')."/quotes/{$this->quote->id}")
            ->line('كلما أسرعنا بالرد، زادت فرصة تحويل الطلب إلى مشروع.');
    }

    /** Keep Echo's notification.type as the app-level slug (default is the FQCN). */
    public function broadcastType(): string
    {
        return 'quote_received';
    }

    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'quote_received',
            'quote_request_id' => $this->quote->id,
            'code' => $this->quote->reference,
            'message' => "طلب تسعير جديد من «{$this->quote->name}»: {$this->quote->title}",
        ];
    }
}
