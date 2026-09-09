<?php

namespace App\Http\Resources;

use App\Models\ProjectFile;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin ProjectFile */
class ProjectFileResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'category' => $this->category,
            // Set on supporting documents that belong to one file rather than to
            // the project — the ID card attached to a particular certificate.
            'parent_file_id' => $this->parent_file_id,
            'document_request_id' => $this->document_request_id,
            // Set on a supporting document the office rejected: still on the record,
            // no longer the answer, and never shown to the translator.
            'superseded_at' => $this->superseded_at?->toIso8601String(),
            'original_name' => $this->original_name,
            'mime_type' => $this->mime_type,
            'size_bytes' => $this->size_bytes,
            'word_count' => $this->word_count,
            'page_count' => $this->page_count,
            'char_count' => $this->char_count,
            'count_status' => $this->count_status,
            'count_source' => $this->count_source,
            'version' => $this->version,
            // Deliverables only: where the translator put the seal on this document.
            // Null means the stamp template's own position still applies, and the
            // approval dialog shows that rather than an empty box.
            'stamp_placement' => $this->stamp_placement,
            'uploaded_by' => $this->whenLoaded('uploader', fn () => $this->uploader ? [
                'id' => $this->uploader->id,
                'name' => $this->uploader->name,
            ] : null),
            // Exactly one of the two is ever set; a file with this one filled came
            // from the client's own area, not from a member of staff.
            'uploaded_by_client' => $this->whenLoaded('clientUploader', fn () => $this->clientUploader ? [
                'id' => $this->clientUploader->id,
                'name' => $this->clientUploader->name,
            ] : null),
            'attachments' => ProjectFileResource::collection($this->whenLoaded('attachments')),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
