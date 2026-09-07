<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\RegisterClientRequest;
use App\Http\Resources\ClientAccountResource;
use App\Models\Client;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Sign-in for the website's client area (M15).
 *
 * A deliberate mirror of AuthController, not an extension of it: the two live on
 * different tables and different guards, and the staff screen must stay reachable
 * only by staff. Tokens are issued on the Client model, so Sanctum's guard check
 * keeps them out of every `auth:sanctum` route in the operations app.
 */
class ClientAuthController extends Controller
{
    public function register(RegisterClientRequest $request): JsonResponse
    {
        $client = Client::create([
            ...$request->validated(),
            'status' => Client::STATUS_ACTIVE,
            'self_registered' => true,
        ]);

        return response()->json([
            'token' => $client->createToken('site')->plainTextToken,
            'client' => ClientAccountResource::make($client),
        ], 201);
    }

    public function login(Request $request): JsonResponse
    {
        $credentials = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        // withAccount(): a walk-in row the office keeps has no password, and
        // Hash::check against null would fatal rather than fail cleanly.
        $client = Client::query()
            ->withAccount()
            ->where('email', mb_strtolower(trim($credentials['email'])))
            ->first();

        if (! $client || ! Hash::check($credentials['password'], $client->password)) {
            throw ValidationException::withMessages(['email' => __('auth.failed')]);
        }

        if ($client->isSuspended()) {
            throw ValidationException::withMessages(['email' => __('clients.account_suspended')]);
        }

        $client->forceFill(['last_login_at' => now()])->save();

        return response()->json([
            'token' => $client->createToken('site')->plainTextToken,
            'client' => ClientAccountResource::make($client),
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => 'ok']);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json(['client' => ClientAccountResource::make($request->user())]);
    }

    /**
     * The client's own contact details. Name and type stay editable because the
     * client is the authority on them; the email does not, because it is the
     * login identity and changing it here would need the same ownership proof
     * registration lacks. The office can change it from the admin screen.
     */
    public function updateProfile(Request $request): JsonResponse
    {
        $client = $request->user();

        $validated = $request->validate([
            'name' => ['required', 'string', 'max:190'],
            'type' => ['required', Rule::in(['individual', 'company'])],
            'phone' => ['nullable', 'string', 'max:30'],
        ]);

        $client->update($validated);

        return response()->json(['client' => ClientAccountResource::make($client)]);
    }

    public function updatePassword(Request $request): JsonResponse
    {
        $client = $request->user();

        $validated = $request->validate([
            'current_password' => ['required', 'string'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ]);

        // Not the `current_password` rule: that one validates against the default
        // guard, which is `web` (staff), so it can never match a client's hash.
        if (! Hash::check($validated['current_password'], $client->password)) {
            throw ValidationException::withMessages(['current_password' => __('auth.password')]);
        }

        $client->update(['password' => $validated['password']]);

        // Every other device is signed out; the one doing the changing stays in.
        $client->tokens()->whereKeyNot($request->user()->currentAccessToken()->id)->delete();

        return response()->json(['message' => 'ok']);
    }
}
