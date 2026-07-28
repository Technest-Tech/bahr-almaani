<?php

namespace App\Events;

use App\Models\Project;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Base for portal queue changes, broadcast to every translator listening on the
 * project's language pair. ShouldBroadcastNow: pushed to Reverb inside the request
 * (no queue hop) so queues update the instant the state changes.
 *
 * Payload is portal-safe by construction — never client identity or pricing.
 */
abstract class PortalQueueEvent implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    public function __construct(public Project $project) {}

    /** @return array<int, PrivateChannel> */
    public function broadcastOn(): array
    {
        return [
            new PrivateChannel(
                "portal.{$this->project->source_language_id}.{$this->project->target_language_id}",
            ),
        ];
    }

    public function broadcastWith(): array
    {
        return [
            'project' => [
                'id' => $this->project->id,
                'code' => $this->project->code,
                'title' => $this->project->title,
                'priority' => $this->project->priority,
                'status' => $this->project->status,
                'deadline_at' => $this->project->deadline_at?->toIso8601String(),
            ],
        ];
    }
}
