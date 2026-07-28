<?php

namespace App\Events;

/**
 * available|claimed → cancelled: with polling gone, translators would otherwise
 * keep seeing a dead card (or a dead current assignment) until the next event.
 */
class ProjectCancelled extends PortalQueueEvent
{
    public function broadcastAs(): string
    {
        return 'project.cancelled';
    }
}
