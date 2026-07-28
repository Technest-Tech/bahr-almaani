<?php

namespace App\Http\Resources;

use App\Models\Project;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Translator-facing project view: NO client identity, NO pricing.
 *
 * @mixin Project
 */
class PortalProjectResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'code' => $this->code,
            'title' => $this->title,
            'status' => $this->status,
            'status_label' => __("projects.status.{$this->status}"),
            'priority' => $this->priority,
            'service_type' => $this->service_type,
            'country_code' => $this->country_code,
            'total_words' => $this->total_words,
            'total_pages' => $this->total_pages,
            'declared_pages' => $this->declared_pages,
            'deadline_at' => $this->deadline_at?->toIso8601String(),
            'is_late' => $this->isLate(),
            'instructions' => $this->instructions,
            'source_language' => LanguageResource::make($this->whenLoaded('sourceLanguage')),
            'target_language' => LanguageResource::make($this->whenLoaded('targetLanguage')),
            'source_files_count' => $this->whenHas('source_files_count'),
            'files' => ProjectFileResource::collection($this->whenLoaded('files')),
        ];
    }
}
