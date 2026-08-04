<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreUserRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:150'],
            'email' => ['required', 'email', 'max:190', Rule::unique('users', 'email')->withoutTrashed()],
            'phone' => ['nullable', 'string', 'max:30'],
            'password' => ['required', 'string', 'min:8'],
            'role' => ['required', 'string', Rule::exists('roles', 'name')],
            'locale' => ['nullable', Rule::in(['ar', 'en'])],
            'monthly_word_target' => ['nullable', 'integer', 'min:0', 'max:500000'],
        ];
    }
}
