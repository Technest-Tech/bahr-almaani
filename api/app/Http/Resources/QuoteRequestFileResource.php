<?php

namespace App\Http\Resources;

use App\Models\QuoteRequestFile;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin QuoteRequestFile */
class QuoteRequestFileResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'original_name' => $this->original_name,
            'mime_type' => $this->mime_type,
            'size_bytes' => (int) $this->size_bytes,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
