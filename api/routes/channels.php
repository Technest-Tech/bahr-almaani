<?php

use App\Models\User;
use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('App.Models.User.{id}', function (User $user, int $id) {
    return (int) $user->id === (int) $id;
});

/*
 * Portal feed for one language pair. A translator may listen only if they
 * hold portal access AND actually own that pair — so nobody can watch
 * queues (or claim races) for languages they don't work in.
 */
Broadcast::channel('portal.{sourceId}.{targetId}', function (User $user, int $sourceId, int $targetId) {
    return $user->can('portal.access')
        && $user->languagePairs()
            ->where('source_language_id', $sourceId)
            ->where('target_language_id', $targetId)
            ->exists();
});
