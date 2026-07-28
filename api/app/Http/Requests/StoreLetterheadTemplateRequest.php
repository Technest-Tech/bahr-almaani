<?php

namespace App\Http\Requests;

use App\Models\LetterheadTemplate;
use App\Support\PlacementConfig;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreLetterheadTemplateRequest extends FormRequest
{
    public const MAX_ASSET_KB = 10240; // 10 MB

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
            'placement' => ['sometimes', 'nullable', 'array'],
            'placement.pages' => ['sometimes', Rule::in(PlacementConfig::PAGES)],
            'placement.anchor' => ['sometimes', Rule::in(PlacementConfig::ANCHORS)],
            'placement.offset_x_mm' => ['sometimes', 'numeric', 'between:-500,500'],
            'placement.offset_y_mm' => ['sometimes', 'numeric', 'between:-500,500'],
            'placement.width_mm' => ['sometimes', 'nullable', 'numeric', 'between:1,1000'],
            'placement.opacity' => ['sometimes', 'numeric', 'between:0,1'],
            'placement.layer' => ['sometimes', Rule::in(PlacementConfig::LAYERS)],
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
