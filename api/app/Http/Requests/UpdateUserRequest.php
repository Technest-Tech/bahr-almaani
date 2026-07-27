<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateUserRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'required', 'string', 'max:150'],
            'email' => [
                'sometimes', 'required', 'email', 'max:190',
                Rule::unique('users', 'email')->ignore($this->route('user'))->withoutTrashed(),
            ],
            'phone' => ['nullable', 'string', 'max:30'],
            'password' => ['sometimes', 'nullable', 'string', 'min:8'],
            'role' => ['sometimes', 'required', 'string', Rule::exists('roles', 'name')],
            'locale' => ['sometimes', Rule::in(['ar', 'en'])],
        ];
    }
}
