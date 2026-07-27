<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureUserIsActive
{
    /**
     * Suspension takes effect immediately: any request from a suspended
     * user revokes all their tokens and is rejected.
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user && $user->isSuspended()) {
            $user->tokens()->delete();

            abort(403, __('auth.suspended'));
        }

        return $next($request);
    }
}
