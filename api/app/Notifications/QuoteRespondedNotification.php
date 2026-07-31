<?php

namespace App\Notifications;

use App\Models\QuoteRequest;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * The quote itself, mailed to the website visitor.
 *
 * Mail only, and no preference check: the recipient is an anonymous notifiable
 * (an email address, not a User) who asked us for exactly this reply.
 */
class QuoteRespondedNotification extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(public QuoteRequest $quote) {}

    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $amount = number_format((float) $this->quote->quoted_amount, 2).' '.$this->quote->currency;

        $mail = (new MailMessage)
            ->subject("عرض السعر جاهز — {$this->quote->reference}")
            ->greeting("مرحباً {$this->quote->name}،")
            ->line("أعددنا عرض السعر لطلبك «{$this->quote->title}».")
            ->line("**التكلفة: {$amount}**");

        if ($this->quote->turnaround_days) {
            $mail->line("مدة التنفيذ المتوقعة: {$this->quote->turnaround_days} يوم عمل.");
        }

        if ($this->quote->response_note) {
            $mail->line($this->quote->response_note);
        }

        return $mail
            ->action('عرض التفاصيل', config('app.frontend_url').'/track?ref='.$this->quote->reference)
            ->line("رقم طلبك للمتابعة: {$this->quote->reference}")
            ->line('للموافقة على العرض أو الاستفسار، ردّ على هذه الرسالة أو تواصل معنا هاتفياً.');
    }
}
