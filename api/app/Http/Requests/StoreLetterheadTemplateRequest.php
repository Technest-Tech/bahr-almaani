<?php

namespace App\Http\Requests;

use App\Models\LetterheadTemplate;
use App\Support\PlacementConfig;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreLetterheadTemplateRequest extends FormRequest
{
    /**
     * 25 MB: the client's own letterhead is a 17 MB 300dpi scan, and the first cap
     * (10 MB) was set before we had seen a real one. Merged output is far smaller —
     * only the page's image stream is embedded, not the whole source file.
     */
    public const MAX_ASSET_KB = 25600;

    public const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'pdf'];

    private function isUpdate(): bool
    {
        return $this->route('letterhead') !== null;
    }

    /** Multipart can only carry strings — accept a JSON-encoded placement too. */
    protected function prepareForValidation(): void
    {
        $placement = $this->input('placement');

        if (is_string($placement)) {
            $this->merge(['placement' => json_decode($placement, true) ?: []]);
        }

        foreach (['is_active'] as $flag) {
            if ($this->has($flag)) {
                $this->merge([$flag => filter_var($this->input($flag), FILTER_VALIDATE_BOOL)]);
            }
        }
    }

    public function rules(): array
    {
        $update = $this->isUpdate();

        return [
            'name' => [$update ? 'sometimes' : 'required', 'string', 'max:150'],
            // The kind drives the placement defaults and the pickers — it is fixed at upload.
            'kind' => $update
                ? ['prohibited']
                : ['required', Rule::in([LetterheadTemplate::KIND_LETTERHEAD, LetterheadTemplate::KIND_STAMP])],
            'asset' => [
                $update ? 'nullable' : 'required',
                'file',
                'mimes:'.implode(',', self::ALLOWED_EXTENSIONS),
                'max:'.self::MAX_ASSET_KB,
            ],
            'is_active' => ['sometimes', 'boolean'],
            // Shared with the portal and the approval dialog — see PlacementConfig::rules().
            // withBand: only a letterhead reserves a content band (M9b).
            ...PlacementConfig::rules(withBand: true),
        ];
    }

    public function messages(): array
    {
        return [
            'asset.mimes' => __('letterheads.asset_mimes'),
            'asset.max' => __('letterheads.asset_max'),
            'kind.prohibited' => __('letterheads.kind_immutable'),
        ];
    }
}
