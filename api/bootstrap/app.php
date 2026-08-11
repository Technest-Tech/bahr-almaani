<?php

use App\Http\Middleware\EnsureUserIsActive;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Spatie\Permission\Middleware\PermissionMiddleware;
use Spatie\Permission\Middleware\RoleMiddleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    // SPA uses bearer tokens, so /broadcasting/auth authenticates via Sanctum (not the web session).
    ->withBroadcasting(
        __DIR__.'/../routes/channels.php',
        ['middleware' => ['auth:sanctum', 'active']],
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // In production the only thing that can reach php-fpm is our own nginx
        // container, so its X-Forwarded-* headers are authoritative — without this
        // the app would generate http:// links (and mis-sign download URLs) behind TLS.
        $middleware->trustProxies(at: '*');

        // This app has no `login` route — the SPA owns that screen — but Laravel
        // registers `redirectGuestsTo(fn () => route('login'))` by default, and the
        // auth middleware calls it while *building* the AuthenticationException.
        // That threw RouteNotFoundException before the exception handler could turn
        // the failure into a 401, so any unauthenticated request that did not ask
        // for JSON came back 500. Returning null hands the decision to the handler
        // below, which answers 401 for everything under /api.
        $middleware->redirectGuestsTo(fn (): ?string => null);

        $middleware->alias([
            'role' => RoleMiddleware::class,
            'permission' => PermissionMiddleware::class,
            'active' => EnsureUserIsActive::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // There is no `login` route in this app — the SPA owns that screen — so an
        // unauthenticated request that did not ask for JSON sent Laravel looking for
        // one and 500'd instead of 401'ing. That is exactly the shape of a download:
        // `<a href>` and `window.open` send `Accept: */*`, never application/json.
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request): bool => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
