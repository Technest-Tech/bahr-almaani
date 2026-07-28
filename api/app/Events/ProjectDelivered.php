<?php

namespace App\Events;

use App\Models\Project;
use App\Models\User;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * claimed|revision_requested → delivered, pushed to the project creator's private
 * channel so the PM's project views refresh live. The user-facing message rides
 * the (queued) broadcast notification; this event only signals data freshness.
 */
class ProjectDelivered implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    public function __construct(
        public Project $project,
        public User $translator,
    ) {}

    /** @return array<int, PrivateChannel> */
    public function broadcastOn(): array
    {
        return [new PrivateChannel("App.Models.User.{$this->project->created_by}")];
    }

    public function broadcastAs(): string
    {
        return 'project.delivered';
    }

    public function broadcastWith(): array
    {
        return [
            'project' => [
                'id' => $this->project->id,
                'code' => $this->project->code,
                'title' => $this->project->title,
                'status' => $this->project->status,
            ],
            'translator' => ['name' => $this->translator->name],
        ];
    }
}
