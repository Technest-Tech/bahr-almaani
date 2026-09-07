<?php

namespace App\Http\Resources;

use App\Models\Client;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The signed-in client's own profile (M15).
 *
 * Deliberately not ClientResource: `notes` is the office's internal note field
 * about the client, and nothing here may hand it back to them.
 *
 * @mixin Client
 */
class ClientAccountResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'type' => $this->type,
            'phone' => $this->phone,
            'email' => $this->email,
            'status' => $this->status,
            'last_login_at' => $this->last_login_at?->toIso8601String(),
            'member_since' => $this->created_at?->toIso8601String(),
        ];
    }
}
