<?php

namespace App\Http\Resources;

use App\Models\LetterheadTemplate;
use App\Support\PlacementConfig;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Translator-facing view of a letterhead or stamp: enough to pick one and see
 * where it lands, and nothing else.
 *
 * Narrower than LetterheadTemplateResource on purpose — no disk filename, no
 * creator, no in_use. A translator picks a template for a draft preview; who
 * uploaded it and which live projects use it are none of their business.
 *
 * @mixin LetterheadTemplate
 */
class PortalTemplateResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'kind' => $this->kind,
            'kind_label' => __("letterheads.kind.{$this->kind}"),
            'mime_type' => $this->isImage() ? 'image' : 'pdf',
            'placement' => PlacementConfig::normalize($this->placement, $this->kind),
        ];
    }
}
