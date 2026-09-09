<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One "we need a document from you" ask.
 *
 * The same shape is served to the office and to the client area. Nothing here is
 * internal: the client is the intended reader of every field, and `requested_by`
 * is deliberately absent for that reason — the office speaks with one voice to a
 * client, exactly as PortalProjectResource hides staff identity from translators.
 */
class DocumentRequestResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'project_file_id' => $this->project_file_id,
            // Which document it is about, named the way the client named it.
            'file_name' => $this->whenLoaded('file', fn () => $this->file?->original_name),
            'kind' => $this->kind,
            'kind_label' => __("projects.document_kind.{$this->kind}"),
            'status' => $this->status,
            'note' => $this->note,
            'created_at' => $this->created_at?->toIso8601String(),
            'fulfilled_at' => $this->fulfilled_at?->toIso8601String(),
            'attachments' => ProjectFileResource::collection($this->whenLoaded('attachments')),
        ];
    }
}
