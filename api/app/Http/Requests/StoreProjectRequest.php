<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreProjectRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'title' => ['required', 'string', 'max:255'],
            'client_id' => ['nullable', 'integer', Rule::exists('clients', 'id')->withoutTrashed()],
            'source_language_id' => ['required', 'integer', Rule::exists('languages', 'id')->where('is_active', true)],
            'target_language_id' => [
                'required', 'integer', 'different:source_language_id',
                Rule::exists('languages', 'id')->where('is_active', true),
            ],
            'country_code' => ['nullable', 'string', 'size:2'],
            'service_type' => ['required', Rule::in(['certified', 'regular'])],
            'priority' => ['required', Rule::in(['normal', 'urgent', 'critical'])],
            'declared_pages' => ['nullable', 'integer', 'min:1', 'max:100000'],
            'deadline_at' => ['required', 'date', 'after:now'],
            'instructions' => ['nullable', 'string', 'max:5000'],
            'quoted_amount' => ['nullable', 'numeric', 'min:0', 'max:99999999'],
        ];
    }
}
