<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Support\NotificationPreferences;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Per-user mail opt-outs (M10). Personal settings — every authenticated user manages
 * their own; there is no permission gate and no way to reach another user's row.
 */
class NotificationPreferenceController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        return response()->json($this->payload($request));
    }

    public function update(Request $request): JsonResponse
    {
        // A partial map is fine — only the families present are written.
        $rules = ['preferences' => ['required', 'array', $this->rejectsUnknownFamilies(...)]];

        foreach (NotificationPreferences::keys() as $family) {
            $rules["preferences.{$family}"] = ['sometimes', 'boolean'];
        }

        $validated = $request->validate($rules);
        $user = $request->user();

        DB::transaction(function () use ($user, $validated): void {
            foreach ($validated['preferences'] as $family => $mail) {
                $user->notificationPreferences()->updateOrCreate(
                    ['family' => $family],
                    ['mail' => $mail],
                );
            }
        });

        $user->unsetRelation('notificationPreferences');

        return response()->json($this->payload($request) + [
            'message' => __('notifications.preferences_saved'),
        ]);
    }

    /** Unknown keys are a client bug, not something to silently persist. */
    private function rejectsUnknownFamilies(string $attribute, mixed $value, \Closure $fail): void
    {
        $unknown = array_diff(array_keys((array) $value), NotificationPreferences::keys());

        if ($unknown !== []) {
            $fail(__('notifications.unknown_family', ['family' => implode('، ', $unknown)]));
        }
    }

    /**
     * @return array{
     *     data: array<string, bool>,
     *     families: list<array{key: string, label: string, description: string}>
     * }
     */
    private function payload(Request $request): array
    {
        return [
            'data' => $request->user()->mailPreferences(),
            'families' => NotificationPreferences::catalog(),
        ];
    }
}
