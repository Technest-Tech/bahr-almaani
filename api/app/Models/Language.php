<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

class Language extends Model
{
    protected $fillable = ['code', 'name_ar', 'name_en', 'is_rtl', 'is_active'];

    protected function casts(): array
    {
        return [
            'is_rtl' => 'boolean',
            'is_active' => 'boolean',
        ];
    }

    #[\Illuminate\Database\Eloquent\Attributes\Scope]
    protected function active(Builder $query): void
    {
        $query->where('is_active', true);
    }
}
