<?php

namespace App\Http\Requests;

use App\Models\Client;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreClientRequest extends FormRequest
{
    protected function prepareForValidation(): void
    {
        // Matches the model's own folding, so `Rule::unique` compares like for like.
        if ($this->filled('email')) {
            $this->merge(['email' => mb_strtolower(trim($this->string('email')->toString()))]);
        }
    }

    public function rules(): array
    {
        $client = $this->route('client');

        // An account needs somewhere to sign in from, so a password makes the email
        // mandatory — either the one being sent now or the one already on the row.
        $wantsAccount = $this->filled('password') || $client?->hasAccount();

        return [
            'name' => ['required', 'string', 'max:190'],
            'type' => ['required', Rule::in(['individual', 'company'])],
            'phone' => ['nullable', 'string', 'max:30'],
            'email' => [
                $wantsAccount ? 'required' : 'nullable',
                'email',
                'max:190',
                // Scoped to rows that can actually be signed in as: the office keeps
                // walk-in clients that legitimately share (or omit) an address, and
                // a blanket unique rule would block editing those.
                Rule::unique('clients', 'email')
                    ->whereNotNull('password')
                    ->whereNull('deleted_at')
                    ->ignore($client),
            ],
            'notes' => ['nullable', 'string', 'max:2000'],

            // Optional on both create and update: leaving it empty on an existing
            // client keeps the current password rather than clearing the account.
            'password' => ['nullable', 'string', 'min:8', 'confirmed'],
            'status' => ['nullable', Rule::in([Client::STATUS_ACTIVE, Client::STATUS_SUSPENDED])],
        ];
    }

    public function messages(): array
    {
        return ['email.unique' => __('clients.email_taken')];
    }
}
