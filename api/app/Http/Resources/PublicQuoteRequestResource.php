<?php

namespace App\Http\Resources;

use App\Models\QuoteRequest;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * What a visitor holding the reference is allowed to see.
 *
 * Deliberately narrower than QuoteRequestResource: no IP, no user agent, no
 * internal ids, no staff identity, and the quote figures only once the request
 * has actually been answered — an unanswered `quoted_amount` would otherwise
 * leak a draft price the moment a manager typed it.
 *
 * @mixin QuoteRequest
 */
class PublicQuoteRequestResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $answered = $this->hasQuote();

        return [
            'reference' => $this->reference,
            'name' => $this->name,
            'title' => $this->title,
            'service_type' => $this->service_type,
            'priority' => $this->priority,
            'declared_pages' => $this->declared_pages,
            'needed_by' => $this->needed_by?->toIso8601String(),
            'status' => $this->status,
            'status_label' => __("quotes.status.{$this->status}"),
            'status_hint' => __("quotes.public_hint.{$this->status}"),
            'submitted_at' => $this->created_at?->toIso8601String(),
            'files_count' => $this->files_count ?? $this->files()->count(),

            'source_language' => LanguageResource::make($this->whenLoaded('sourceLanguage')),
            'target_language' => LanguageResource::make($this->whenLoaded('targetLanguage')),

            'answered' => $answered,
            'quote' => $answered ? [
                'amount' => $this->quoted_amount,
                'currency' => $this->currency,
                'turnaround_days' => $this->turnaround_days,
                'note' => $this->response_note,
                'responded_at' => $this->responded_at?->toIso8601String(),
            ] : null,

            // Set once the job is running, so a returning client sees it went ahead.
            'project_code' => $this->whenLoaded('project', fn () => $this->project->code),
        ];
    }
}
