<?php

namespace App\Http\Resources;

use App\Models\Client;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Client */
class ClientResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'type' => $this->type,
            'phone' => $this->phone,
            'email' => $this->email,
            'notes' => $this->notes,
            // M15 — the website account. `has_account` is what the clients table
            // shows as a badge; the password itself is never serialised.
            'has_account' => $this->hasAccount(),
            'status' => $this->status,
            'self_registered' => (bool) $this->self_registered,
            'last_login_at' => $this->last_login_at?->toIso8601String(),
            'projects_count' => $this->whenCounted('projects'),
            'invoices_count' => $this->whenCounted('invoices'),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
