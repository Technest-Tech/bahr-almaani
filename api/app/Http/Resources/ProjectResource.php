<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin \App\Models\Project */
class ProjectResource extends JsonResource
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
            'declared_pages' => $this->declared_pages,
            'total_words' => $this->total_words,
            'total_pages' => $this->total_pages,
            'deadline_at' => $this->deadline_at?->toIso8601String(),
            'is_late' => $this->isLate(),
            'instructions' => $this->instructions,
            'quoted_amount' => $this->quoted_amount,
            'currency' => $this->currency,
            'published_at' => $this->published_at?->toIso8601String(),
            'completed_at' => $this->completed_at?->toIso8601String(),
            'cancelled_at' => $this->cancelled_at?->toIso8601String(),
            'cancel_reason' => $this->cancel_reason,
            'created_at' => $this->created_at?->toIso8601String(),
            'client' => ClientResource::make($this->whenLoaded('client')),
            'source_language' => LanguageResource::make($this->whenLoaded('sourceLanguage')),
            'target_language' => LanguageResource::make($this->whenLoaded('targetLanguage')),
            'creator' => $this->whenLoaded('creator', fn () => [
                'id' => $this->creator->id,
                'name' => $this->creator->name,
            ]),
            'files' => ProjectFileResource::collection($this->whenLoaded('files')),
            'files_count' => $this->whenCounted('files'),
            'assignment' => AssignmentResource::make($this->whenLoaded('assignments', function () {
                return $this->assignments
                    ->sortByDesc('claimed_at')
                    ->first(fn ($a) => $a->status !== \App\Models\Assignment::STATUS_WITHDRAWN)
                    ?? $this->assignments->sortByDesc('claimed_at')->first();
            })),
        ];
    }
}
