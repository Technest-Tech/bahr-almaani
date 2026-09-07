<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Self-registration from the public website.
 *
 * The address is unique against *every* client row, not just the ones carrying an
 * account: a visitor who types the email of a client the office already has on
 * file must not silently take over that client's project history. Nothing proves
 * ownership of an address yet (no verification mail), so those cases are sent to
 * the office, which activates the existing row by setting a password on it.
 */
class RegisterClientRequest extends FormRequest
{
    protected function prepareForValidation(): void
    {
        if ($this->filled('email')) {
            $this->merge(['email' => mb_strtolower(trim($this->string('email')->toString()))]);
        }
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:190'],
            'type' => ['required', Rule::in(['individual', 'company'])],
            'phone' => ['nullable', 'string', 'max:30'],
            'email' => [
                'required', 'email', 'max:190',
                Rule::unique('clients', 'email')->whereNull('deleted_at'),
            ],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ];
    }

    public function messages(): array
    {
        return ['email.unique' => __('clients.email_registered')];
    }
}
