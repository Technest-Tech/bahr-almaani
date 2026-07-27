<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreUserRequest;
use App\Http\Requests\UpdateUserRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;

class UserController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $users = User::query()
            ->with('roles')
            ->when($request->filled('q'), function ($query) use ($request): void {
                $q = '%'.$request->string('q')->trim().'%';
                $query->where(fn ($w) => $w->where('name', 'ilike', $q)->orWhere('email', 'ilike', $q));
            })
            ->when($request->filled('role'), fn ($query) => $query->role($request->string('role')->toString()))
            ->when($request->filled('status'), fn ($query) => $query->where('status', $request->string('status')->toString()))
            ->orderByDesc('created_at')
            ->paginate(min($request->integer('per_page', 15), 100));

        return UserResource::collection($users);
    }

    public function show(User $user): UserResource
    {
        return UserResource::make(
            $user->load('roles', 'languagePairs.sourceLanguage', 'languagePairs.targetLanguage')
        );
    }

    public function store(StoreUserRequest $request): JsonResponse
    {
        $validated = $request->validated();

        $user = User::create([
            'name' => $validated['name'],
            'email' => $validated['email'],
            'phone' => $validated['phone'] ?? null,
            'password' => $validated['password'],
            'locale' => $validated['locale'] ?? 'ar',
        ]);
        $user->syncRoles([$validated['role']]);

        return UserResource::make($user->load('roles'))
            ->response()
            ->setStatusCode(201);
    }

    public function update(UpdateUserRequest $request, User $user): UserResource
    {
        $validated = $request->validated();

        $user->fill(collect($validated)->only(['name', 'email', 'phone', 'locale'])->all());

        if (! empty($validated['password'])) {
            $user->password = $validated['password'];
        }

        $user->save();

        if (isset($validated['role'])) {
            $user->syncRoles([$validated['role']]);
        }

        return UserResource::make($user->load('roles'));
    }

    public function updateStatus(Request $request, User $user): UserResource
    {
        $validated = $request->validate([
            'status' => ['required', Rule::in([User::STATUS_ACTIVE, User::STATUS_SUSPENDED])],
        ]);

        abort_if($user->is($request->user()), 422, __('users.cannot_change_own_status'));

        $user->update(['status' => $validated['status']]);

        if ($user->isSuspended()) {
            $user->tokens()->delete(); // immediate revoke — suspension is instant
        }

        return UserResource::make($user->load('roles'));
    }

    public function destroy(Request $request, User $user): JsonResponse
    {
        abort_if($user->is($request->user()), 422, __('users.cannot_delete_self'));

        $user->tokens()->delete();
        $user->delete();

        return response()->json(['message' => 'ok']);
    }
}
