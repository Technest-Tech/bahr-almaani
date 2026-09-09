<?php

namespace App\Http\Resources;

use App\Models\Project;
use App\Models\ProjectFile;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A project as its own client sees it in the website's client area (M15).
 *
 * Narrower than ProjectResource on purpose: no internal status, no assignment, no
 * creator, no merge state, and files limited to what the client has a claim on —
 * what they handed in, what they get back, and the supporting documents they were
 * asked for. See ProjectFile::isVisibleToClient().
 *
 * @mixin Project
 */
class ClientProjectResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $stage = $this->clientStage();

        return [
            'id' => $this->id,
            'code' => $this->code,
            'title' => $this->title,
            'stage' => $stage,
            'stage_label' => __("clients.stage.{$stage}"),
            'stage_hint' => __("clients.stage_hint.{$stage}"),
            'service_type' => $this->service_type,
            'priority' => $this->priority,
            'country_code' => $this->country_code,
            // Pages first: the delivered basis is what the invoice bills, with the
            // source count standing in until the certified file exists.
            'pages' => $this->delivered_pages ?? $this->total_pages,
            'words' => $this->delivered_words ?? $this->total_words,
            'is_delivered_basis' => $this->delivered_pages !== null || $this->delivered_words !== null,
            'deadline_at' => $this->deadline_at?->toIso8601String(),
            'quoted_amount' => $this->quoted_amount,
            'currency' => $this->currency,
            'published_at' => $this->published_at?->toIso8601String(),
            'completed_at' => $this->completed_at?->toIso8601String(),
            'cancelled_at' => $this->cancelled_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
            'source_language' => LanguageResource::make($this->whenLoaded('sourceLanguage')),
            'target_language' => LanguageResource::make($this->whenLoaded('targetLanguage')),
            'invoice_number' => $this->whenLoaded('invoice', fn () => $this->invoice?->number),
            // "You still owe us a document" — the one thing on the client's list
            // that is waiting on THEM rather than on us.
            'awaiting_documents' => $this->awaitsDocuments(),
            'has_final_file' => $this->whenLoaded(
                'files',
                fn (): bool => $this->files->contains('category', ProjectFile::CATEGORY_FINAL),
            ),
            'files' => $this->whenLoaded('files', fn () => $this->files
                ->filter(fn (ProjectFile $file): bool => $file->isVisibleToClient())
                ->map(fn (ProjectFile $file): array => [
                    'id' => $file->id,
                    'category' => $file->category,
                    'original_name' => $file->original_name,
                    'size_bytes' => $file->size_bytes,
                    'page_count' => $file->page_count,
                    'word_count' => $file->word_count,
                    'document_request_id' => $file->document_request_id,
                    'created_at' => $file->created_at?->toIso8601String(),
                ])
                ->values()),
            // What the office is still waiting for, and what has already been
            // supplied — the client area turns the open ones into an upload box.
            'document_requests' => DocumentRequestResource::collection(
                $this->whenLoaded('documentRequests'),
            ),
        ];
    }
}
