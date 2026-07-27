<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin \App\Models\Assignment */
class AssignmentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'status' => $this->status,
            'claimed_at' => $this->claimed_at?->toIso8601String(),
            'delivered_at' => $this->delivered_at?->toIso8601String(),
            'work_seconds' => $this->work_seconds,
            'withdraw_reason' => $this->withdraw_reason,
            'translator' => $this->whenLoaded('translator', fn () => [
                'id' => $this->translator->id,
                'name' => $this->translator->name,
            ]),
            'project' => PortalProjectResource::make($this->whenLoaded('project')),
        ];
    }
}
