<?php

namespace App\Http\Resources;

use App\Models\QuoteRequest;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Staff-facing view of a quote request — everything, including who sent it and
 * from where. The visitor's own view is PublicQuoteRequestResource.
 *
 * @mixin QuoteRequest
 */
class QuoteRequestResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'reference' => $this->reference,
            'name' => $this->name,
            'email' => $this->email,
            'phone' => $this->phone,
            'organization' => $this->organization,

            'title' => $this->title,
            'service_type' => $this->service_type,
            'priority' => $this->priority,
            'declared_pages' => $this->declared_pages,
            'needed_by' => $this->needed_by?->toIso8601String(),
            'details' => $this->details,

            'status' => $this->status,
            'status_label' => __("quotes.status.{$this->status}"),

            'quoted_amount' => $this->quoted_amount,
            'currency' => $this->currency,
            'turnaround_days' => $this->turnaround_days,
            'response_note' => $this->response_note,
            'responded_at' => $this->responded_at?->toIso8601String(),

            'ip_address' => $this->ip_address,
            'created_at' => $this->created_at?->toIso8601String(),

            'source_language' => LanguageResource::make($this->whenLoaded('sourceLanguage')),
            'target_language' => LanguageResource::make($this->whenLoaded('targetLanguage')),
            'responder' => $this->whenLoaded('responder', fn () => [
                'id' => $this->responder->id,
                'name' => $this->responder->name,
            ]),
            'client' => ClientResource::make($this->whenLoaded('client')),
            'project' => $this->whenLoaded('project', fn () => [
                'id' => $this->project->id,
                'code' => $this->project->code,
                'status' => $this->project->status,
                'status_label' => __("projects.status.{$this->project->status}"),
            ]),
            'files' => QuoteRequestFileResource::collection($this->whenLoaded('files')),
            'files_count' => $this->whenCounted('files'),
        ];
    }
}
