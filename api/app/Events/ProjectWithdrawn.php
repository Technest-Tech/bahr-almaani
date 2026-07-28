<?php

namespace App\Events;

/** claimed → available (PM withdrew it): back in the queue for everyone on the pair. */
class ProjectWithdrawn extends PortalQueueEvent
{
    public function broadcastAs(): string
    {
        return 'project.withdrawn';
    }
}
