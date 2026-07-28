<?php

namespace App\Notifications\Concerns;

use App\Models\User;

/**
 * Builds the channel list for a notification family: the bell (database) and the live
 * broadcast are always on, mail is appended only when the recipient hasn't opted out.
 */
trait RespectsMailPreference
{
    /** @return list<string> */
    protected function channelsFor(object $notifiable, string $family): array
    {
        $channels = ['database', 'broadcast'];

        if ($notifiable instanceof User && $notifiable->wantsMail($family)) {
            $channels[] = 'mail';
        }

        return $channels;
    }
}
