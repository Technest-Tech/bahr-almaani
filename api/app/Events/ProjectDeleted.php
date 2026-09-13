<?php

namespace App\Events;

/**
 * An available project was deleted: its card has to leave every translator's queue
 * the way a cancelled one does, or someone claims a file that no longer exists.
 */
class ProjectDeleted extends PortalQueueEvent
{
    public function broadcastAs(): string
    {
        return 'project.deleted';
    }
}
