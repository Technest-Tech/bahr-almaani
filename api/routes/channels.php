<?php

use App\Models\User;
use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('App.Models.User.{id}', function (User $user, int $id) {
    return (int) $user->id === (int) $id;
});

/*
 * The shared portal feed. Every translator sees every available file, so the
 * only thing that gates this channel is portal access itself — the language
 * pair a translator registered no longer decides what they may watch.
 *
 * Still a private channel: the payload describes unpublished-to-clients work,
 * and nobody without portal.access (clients, accountants) may listen.
 */
Broadcast::channel('portal', function (User $user) {
    return $user->can('portal.access');
});
