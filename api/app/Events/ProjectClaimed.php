<?php

namespace App\Events;

/** available → claimed: remove the card from every other translator's queue. */
class ProjectClaimed extends PortalQueueEvent
{
    public function broadcastAs(): string
    {
        return 'project.claimed';
    }
}
