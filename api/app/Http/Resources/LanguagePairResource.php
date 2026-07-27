<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin \App\Models\TranslatorLanguagePair */
class LanguagePairResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'source_language' => LanguageResource::make($this->whenLoaded('sourceLanguage')),
            'target_language' => LanguageResource::make($this->whenLoaded('targetLanguage')),
            'source_language_id' => $this->source_language_id,
            'target_language_id' => $this->target_language_id,
        ];
    }
}
