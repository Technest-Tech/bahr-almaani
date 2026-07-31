<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Public submission — no authenticated user behind it, so every rule here is the
 * only thing standing between the internet and our storage disk.
 */
class StoreQuoteRequestRequest extends FormRequest
{
    /** 25 MB per attachment, ten at most: enough for a scanned contract, not a film. */
    public const MAX_FILE_KB = 25600;

    public const MAX_FILES = 10;

    /** Document formats a translation office actually receives. */
    public const ALLOWED_EXTENSIONS = [
        'pdf', 'doc', 'docx', 'rtf', 'txt', 'odt',
        'xls', 'xlsx', 'ppt', 'pptx',
        'jpg', 'jpeg', 'png', 'webp', 'heic', 'tif', 'tiff',
        'zip',
    ];

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:190'],
            'email' => ['required', 'email:rfc', 'max:190'],
            'phone' => ['nullable', 'string', 'max:30'],
            'organization' => ['nullable', 'string', 'max:190'],

            'title' => ['required', 'string', 'max:255'],
            'source_language_id' => ['nullable', 'integer', Rule::exists('languages', 'id')->where('is_active', true)],
            'target_language_id' => [
                'nullable', 'integer', 'different:source_language_id',
                Rule::exists('languages', 'id')->where('is_active', true),
            ],
            'service_type' => ['required', Rule::in(['certified', 'regular'])],
            'priority' => ['required', Rule::in(['normal', 'urgent', 'critical'])],
            'declared_pages' => ['nullable', 'integer', 'min:1', 'max:100000'],
            'needed_by' => ['nullable', 'date', 'after:now'],
            'details' => ['nullable', 'string', 'max:5000'],

            'files' => ['nullable', 'array', 'max:'.self::MAX_FILES],
            'files.*' => [
                'file',
                'max:'.self::MAX_FILE_KB,
                'extensions:'.implode(',', self::ALLOWED_EXTENSIONS),
            ],
        ];
    }

    public function attributes(): array
    {
        return __('quotes.attributes');
    }
}
