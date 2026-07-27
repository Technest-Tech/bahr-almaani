<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function login(Request $request): JsonResponse
    {
        $credentials = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
            'device_name' => ['nullable', 'string', 'max:100'],
        ]);

        $user = User::where('email', $credentials['email'])->first();

        if (! $user || ! Hash::check($credentials['password'], $user->password)) {
            throw ValidationException::withMessages(['email' => __('auth.failed')]);
        }

        if ($user->isSuspended()) {
            throw ValidationException::withMessages(['email' => __('auth.suspended')]);
        }

        $user->forceFill(['last_login_at' => now()])->save();

        $token = $user->createToken($credentials['device_name'] ?? 'spa')->plainTextToken;

        return response()->json([
            'token' => $token,
            'user' => UserResource::make($user->load('languagePairs.sourceLanguage', 'languagePairs.targetLanguage')),
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => 'ok']);
    }

    public function me(Request $request): JsonResponse
    {
        $user = $request->user()->load('languagePairs.sourceLanguage', 'languagePairs.targetLanguage');

        return response()->json([
            'user' => UserResource::make($user),
            'permissions' => $user->getAllPermissions()->pluck('name'),
        ]);
    }

    public function updatePassword(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'current_password' => ['required', 'current_password'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ]);

        $user = $request->user();
        $user->update(['password' => $validated['password']]);

        // Revoke every other session; keep the current one alive.
        $user->tokens()->whereKeyNot($user->currentAccessToken()->id)->delete();

        return response()->json(['message' => 'ok']);
    }
}
