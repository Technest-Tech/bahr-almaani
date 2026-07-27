<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\SyncLanguagePairsRequest;
use App\Http\Resources\LanguagePairResource;
use App\Models\User;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;

class UserLanguagePairController extends Controller
{
    public function index(User $user): AnonymousResourceCollection
    {
        return LanguagePairResource::collection(
            $user->languagePairs()->with('sourceLanguage', 'targetLanguage')->get()
        );
    }

    public function sync(SyncLanguagePairsRequest $request, User $user): AnonymousResourceCollection
    {
        abort_unless($user->hasRole('translator'), 422, __('users.language_pairs_translators_only'));

        $pairs = collect($request->validated('pairs'))
            ->map(fn (array $pair) => [
                'source_language_id' => $pair['source_language_id'],
                'target_language_id' => $pair['target_language_id'],
            ])
            ->unique(fn (array $pair) => $pair['source_language_id'].'-'.$pair['target_language_id']);

        DB::transaction(function () use ($user, $pairs): void {
            $user->languagePairs()->delete();
            $user->languagePairs()->createMany($pairs->all());
        });

        return LanguagePairResource::collection(
            $user->languagePairs()->with('sourceLanguage', 'targetLanguage')->get()
        );
    }
}
