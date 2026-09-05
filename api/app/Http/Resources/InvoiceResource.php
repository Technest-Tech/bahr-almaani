<?php

namespace App\Http\Resources;

use App\Models\Invoice;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Invoice */
class InvoiceResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'number' => $this->number,
            'client' => ClientResource::make($this->whenLoaded('client')),
            'total_pages' => $this->total_pages,
            'total_words' => $this->total_words,
            'unit_price' => $this->unit_price,
            'amount' => $this->amount,
            'currency' => $this->currency,
            'notes' => $this->notes,
            'line_items' => $this->line_items,
            'issued_at' => $this->issued_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
            'creator' => $this->whenLoaded('creator', fn () => [
                'id' => $this->creator->id,
                'name' => $this->creator->name,
            ]),
        ];
    }
}
