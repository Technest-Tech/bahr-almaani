<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->registerRateLimiters();
    }

    /**
     * Named limiters for the public website (M13).
     *
     * These MUST be named. An inline `throttle:5,60` derives its key from the
     * domain and the IP — never the path — so every unauthenticated throttled
     * route on the host shares one bucket: five quote submissions would lock the
     * same visitor out of /auth/login for the full hour. Naming the limiter
     * namespaces the key and keeps the buckets independent.
     */
    private function registerRateLimiters(): void
    {
        // Writes uploads to disk, so it carries the tightest limit on the site.
        RateLimiter::for('quote-submissions', fn (Request $request) => Limit::perHour(5)->by($request->ip()));

        // Guessing a reference is already hopeless (~40 bits); this only makes it slow.
        RateLimiter::for('quote-lookups', fn (Request $request) => Limit::perMinute(20)->by($request->ip()));
    }
}
