<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class SyncLanguagePairsRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'pairs' => ['present', 'array', 'max:50'],
            'pairs.*.source_language_id' => ['required', 'integer', Rule::exists('languages', 'id')->where('is_active', true)],
            'pairs.*.target_language_id' => [
                'required', 'integer',
                Rule::exists('languages', 'id')->where('is_active', true),
                'different:pairs.*.source_language_id',
            ],
        ];
    }

    public function messages(): array
    {
        return [
            'pairs.*.target_language_id.different' => __('validation.custom.language_pair_same'),
        ];
    }
}
