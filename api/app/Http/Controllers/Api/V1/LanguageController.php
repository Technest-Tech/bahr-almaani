<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\LanguageResource;
use App\Models\Language;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class LanguageController extends Controller
{
    public function index(): AnonymousResourceCollection
    {
        return LanguageResource::collection(
            Language::active()->orderBy('name_ar')->get()
        );
    }
}
