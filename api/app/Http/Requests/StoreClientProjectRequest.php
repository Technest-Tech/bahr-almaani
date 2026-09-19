<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * A signed-in client starting a project from their own area.
 *
 * The public quote form without the contact section — the account already says who
 * they are — and stricter where a project needs it: the language pair and a date
 * are required, because the project table has no room for "unknown" in either.
 * The date is the client's ask; the PM confirms or moves it before publishing.
 *
 * Attachments take the quote form's formats and sizes: this is the same intake,
 * the documents the office is asked to translate, not the identity scans the
 * client area otherwise takes (ClientPortalController::uploadFile).
 */
class StoreClientProjectRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            // Optional: left blank, the first file names the project, as in the office.
            'title' => ['nullable', 'string', 'max:255'],
            'source_language_id' => ['required', 'integer', Rule::exists('languages', 'id')->where('is_active', true)],
            'target_language_id' => [
                'required', 'integer', 'different:source_language_id',
                Rule::exists('languages', 'id')->where('is_active', true),
            ],
            'service_type' => ['required', Rule::in(['certified', 'regular'])],
            'priority' => ['required', Rule::in(['normal', 'urgent', 'critical'])],
            'declared_pages' => ['nullable', 'integer', 'min:1', 'max:100000'],
            'deadline_at' => ['required', 'date', 'after:now'],
            'instructions' => ['nullable', 'string', 'max:5000'],
            ...self::fileRules(),
        ];
    }

    /**
     * The documents to translate — shared with a later upload to the same draft, so
     * the first batch and page two arrive under the same rules.
     *
     * @return array<string, list<string>>
     */
    public static function fileRules(): array
    {
        return [
            'files' => ['required', 'array', 'min:1', 'max:'.StoreQuoteRequestRequest::MAX_FILES],
            'files.*' => [
                'file',
                'max:'.StoreQuoteRequestRequest::MAX_FILE_KB,
                'extensions:'.implode(',', StoreQuoteRequestRequest::ALLOWED_EXTENSIONS),
            ],
        ];
    }

    public function attributes(): array
    {
        return [
            ...__('quotes.attributes'),
            'title' => __('projects.client_attributes.title'),
            'deadline_at' => __('projects.client_attributes.deadline_at'),
            'instructions' => __('projects.client_attributes.instructions'),
        ];
    }
}
