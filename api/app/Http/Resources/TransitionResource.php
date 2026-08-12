<?php

namespace App\Http\Resources;

use App\Models\StatusTransition;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin StatusTransition */
class TransitionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'from_status' => $this->from_status,
            'from_label' => __("projects.status.{$this->from_status}"),
            'to_status' => $this->to_status,
            'to_label' => __("projects.status.{$this->to_status}"),
            'note' => $this->note,
            // Present on revision requests: what the PM attached to that round.
            'attachments' => ProjectFileResource::collection($this->whenLoaded('attachments')),
            'actor' => $this->whenLoaded('actor', fn () => $this->actor ? [
                'id' => $this->actor->id,
                'name' => $this->actor->name,
            ] : null),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
