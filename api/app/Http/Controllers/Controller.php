<?php

namespace App\Http\Controllers;

abstract class Controller
{
    /**
     * Realtime is best-effort: a down websocket server must never fail the request.
     * The braces (not an arrow fn) matter — an arrow fn would return the
     * PendingBroadcast, deferring its dispatching destructor past rescue's catch.
     */
    protected function broadcastLive(object $event): void
    {
        rescue(function () use ($event): void {
            broadcast($event);
        });
    }
}
