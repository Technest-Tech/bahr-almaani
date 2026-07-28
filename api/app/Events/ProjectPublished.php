<?php

namespace App\Events;

/** draft → available: the project just entered the portal queue. */
class ProjectPublished extends PortalQueueEvent
{
    public function broadcastAs(): string
    {
        return 'project.published';
    }
}
