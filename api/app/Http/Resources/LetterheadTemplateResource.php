<?php

namespace App\Http\Resources;

use App\Models\LetterheadTemplate;
use App\Support\PlacementConfig;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin LetterheadTemplate */
class LetterheadTemplateResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'kind' => $this->kind,
            'kind_label' => __("letterheads.kind.{$this->kind}"),
            'file_name' => basename($this->disk_path),
            'mime_type' => $this->isImage() ? 'image' : 'pdf',
            'is_active' => $this->is_active,
            // Always normalized so the merge job (and the UI form) never sees a missing key.
            'placement' => PlacementConfig::normalize($this->placement, $this->kind),
            // Present whenever the controller counted usages — drives the delete affordance.
            'in_use' => $this->when(
                $this->letterhead_projects_count !== null,
                fn () => $this->letterhead_projects_count + $this->stamp_projects_count > 0,
            ),
            'created_by' => $this->whenLoaded('creator', fn () => [
                'id' => $this->creator->id,
                'name' => $this->creator->name,
            ]),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
