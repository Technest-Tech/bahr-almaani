<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** The priced answer a manager sends back to a website visitor. */
class RespondToQuoteRequestRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'quoted_amount' => ['required', 'numeric', 'min:0', 'max:99999999'],
            'currency' => ['required', 'string', 'size:3'],
            'turnaround_days' => ['nullable', 'integer', 'min:1', 'max:365'],
            'response_note' => ['nullable', 'string', 'max:5000'],
            /** Skip the courtesy mail when the client was already told by phone. */
            'notify_client' => ['sometimes', 'boolean'],
        ];
    }

    public function attributes(): array
    {
        return __('quotes.attributes');
    }
}
