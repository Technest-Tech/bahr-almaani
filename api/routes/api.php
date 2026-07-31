<?php

use App\Http\Controllers\Api\V1\ActivityLogController;
use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\ClientController;
use App\Http\Controllers\Api\V1\DashboardController;
use App\Http\Controllers\Api\V1\LanguageController;
use App\Http\Controllers\Api\V1\LetterheadController;
use App\Http\Controllers\Api\V1\NotificationController;
use App\Http\Controllers\Api\V1\NotificationPreferenceController;
use App\Http\Controllers\Api\V1\PortalController;
use App\Http\Controllers\Api\V1\ProjectController;
use App\Http\Controllers\Api\V1\ProjectFileController;
use App\Http\Controllers\Api\V1\PublicQuoteRequestController;
use App\Http\Controllers\Api\V1\QuoteRequestController;
use App\Http\Controllers\Api\V1\ReportController;
use App\Http\Controllers\Api\V1\ReviewController;
use App\Http\Controllers\Api\V1\RoleController;
use App\Http\Controllers\Api\V1\UserController;
use App\Http\Controllers\Api\V1\UserLanguagePairController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function (): void {
    Route::post('/auth/login', [AuthController::class, 'login'])
        ->middleware('throttle:5,1');

    /*
     * M13 — the public website. No authentication: these four routes are what an
     * anonymous visitor reaches. Submission is throttled hard because it writes
     * files, and the lookup is throttled because the reference is the only secret.
     */
    Route::prefix('public')->group(function (): void {
        Route::get('/languages', [PublicQuoteRequestController::class, 'languages']);
        Route::get('/quote-requests/limits', [PublicQuoteRequestController::class, 'limits']);

        Route::post('/quote-requests', [PublicQuoteRequestController::class, 'store'])
            ->middleware('throttle:quote-submissions');

        Route::get('/quote-requests/{reference}', [PublicQuoteRequestController::class, 'show'])
            ->middleware('throttle:quote-lookups');
    });

    Route::middleware(['auth:sanctum', 'active'])->group(function (): void {
        // Auth
        Route::post('/auth/logout', [AuthController::class, 'logout']);
        Route::get('/auth/me', [AuthController::class, 'me']);
        Route::put('/auth/me/password', [AuthController::class, 'updatePassword']);

        // Lookups
        Route::get('/languages', [LanguageController::class, 'index']);

        // Users & roles (M2)
        Route::middleware('permission:users.view|users.manage')->group(function (): void {
            Route::get('/users', [UserController::class, 'index']);
            Route::get('/users/{user}', [UserController::class, 'show']);
        });

        Route::middleware('permission:users.manage')->group(function (): void {
            Route::post('/users', [UserController::class, 'store']);
            Route::put('/users/{user}', [UserController::class, 'update']);
            Route::delete('/users/{user}', [UserController::class, 'destroy']);
            Route::put('/users/{user}/status', [UserController::class, 'updateStatus']);
            Route::get('/users/{user}/language-pairs', [UserLanguagePairController::class, 'index']);
            Route::put('/users/{user}/language-pairs', [UserLanguagePairController::class, 'sync']);
        });

        Route::middleware('permission:roles.manage')->group(function (): void {
            Route::get('/roles', [RoleController::class, 'index']);
            Route::get('/permissions', [RoleController::class, 'permissions']);
            Route::put('/roles/{role}/permissions', [RoleController::class, 'syncPermissions']);
        });

        // Clients (M3)
        Route::middleware('permission:clients.view|clients.manage')->group(function (): void {
            Route::get('/clients', [ClientController::class, 'index']);
            Route::get('/clients/{client}', [ClientController::class, 'show']);
        });

        Route::middleware('permission:clients.manage')->group(function (): void {
            Route::post('/clients', [ClientController::class, 'store']);
            Route::put('/clients/{client}', [ClientController::class, 'update']);
            Route::delete('/clients/{client}', [ClientController::class, 'destroy']);
        });

        // Projects (M3 + M5)
        Route::middleware('permission:projects.view|projects.manage')->group(function (): void {
            Route::get('/projects', [ProjectController::class, 'index']);
            Route::get('/projects/{project}', [ProjectController::class, 'show']);
            Route::get('/projects/{project}/timeline', [ProjectController::class, 'timeline']);
            Route::get('/projects/{project}/files/{file}/download', [ProjectFileController::class, 'download']);
            Route::get('/projects/{project}/final-file', [ProjectFileController::class, 'finalFile']);
        });

        Route::middleware('permission:projects.manage')->group(function (): void {
            Route::post('/projects', [ProjectController::class, 'store']);
            Route::put('/projects/{project}', [ProjectController::class, 'update']);
            Route::post('/projects/{project}/publish', [ProjectController::class, 'publish']);
            Route::post('/projects/{project}/cancel', [ProjectController::class, 'cancel']);
            Route::post('/projects/{project}/archive', [ProjectController::class, 'archive']);
            Route::post('/projects/{project}/withdraw', [ProjectController::class, 'withdraw']);
            Route::post('/projects/{project}/files', [ProjectFileController::class, 'store']);
            Route::delete('/projects/{project}/files/{file}', [ProjectFileController::class, 'destroy']);
            Route::put('/projects/{project}/files/{file}/manual-count', [ProjectFileController::class, 'manualCount']);
        });

        // Quote requests from the public site (M13)
        Route::middleware('permission:quotes.view|quotes.manage')->group(function (): void {
            Route::get('/quote-requests', [QuoteRequestController::class, 'index']);
            Route::get('/quote-requests/{quoteRequest}', [QuoteRequestController::class, 'show']);
            Route::get('/quote-requests/{quoteRequest}/files/{fileId}', [QuoteRequestController::class, 'downloadFile']);
        });

        Route::middleware('permission:quotes.manage')->group(function (): void {
            Route::put('/quote-requests/{quoteRequest}/status', [QuoteRequestController::class, 'updateStatus']);
            Route::post('/quote-requests/{quoteRequest}/respond', [QuoteRequestController::class, 'respond']);
            Route::delete('/quote-requests/{quoteRequest}', [QuoteRequestController::class, 'destroy']);
        });

        // Separate gate: this one creates a project and schedules translators.
        Route::middleware('permission:quotes.convert')->group(function (): void {
            Route::post('/quote-requests/{quoteRequest}/convert', [QuoteRequestController::class, 'convert']);
        });

        // Review flow (M5)
        Route::middleware('permission:projects.review')->group(function (): void {
            Route::post('/projects/{project}/review/open', [ReviewController::class, 'open']);
            Route::post('/projects/{project}/review/request-revision', [ReviewController::class, 'requestRevision']);
            Route::post('/projects/{project}/review/approve', [ReviewController::class, 'approve']);
            Route::post('/projects/{project}/merge/retry', [ReviewController::class, 'retryMerge']);
        });

        // Translator portal (M4)
        Route::middleware('permission:portal.access')->prefix('portal')->group(function (): void {
            Route::get('/queue', [PortalController::class, 'queue']);
            Route::post('/claim/{project}', [PortalController::class, 'claim'])
                ->middleware('throttle:10,1');
            Route::get('/current', [PortalController::class, 'current']);
            Route::post('/deliver', [PortalController::class, 'deliver']);
            Route::get('/history', [PortalController::class, 'history']);
            Route::get('/files/{fileId}/download', [PortalController::class, 'downloadFile']);
        });

        // Dashboard (M6)
        Route::middleware('permission:dashboard.view')->prefix('dashboard')->group(function (): void {
            Route::get('/summary', [DashboardController::class, 'summary']);
            Route::get('/throughput', [DashboardController::class, 'throughput']);
            Route::get('/workload', [DashboardController::class, 'workload']);
            Route::get('/late', [DashboardController::class, 'late']);
        });

        // Reports (M7)
        Route::prefix('reports')->group(function (): void {
            Route::middleware('permission:reports.export')->group(function (): void {
                Route::post('/export', [ReportController::class, 'export']);
                Route::get('/exports', [ReportController::class, 'exports']);
                Route::get('/exports/{export}/download', [ReportController::class, 'download']);
            });
            Route::get('/{type}', [ReportController::class, 'show'])
                ->middleware('permission:reports.view');
        });

        // Letterheads & stamps (M9)
        Route::middleware('permission:letterheads.view|letterheads.manage')->group(function (): void {
            Route::get('/letterheads', [LetterheadController::class, 'index']);
            Route::get('/letterheads/{letterhead}/asset', [LetterheadController::class, 'asset']);
        });

        Route::middleware('permission:letterheads.manage')->group(function (): void {
            Route::post('/letterheads/{letterhead}/preview', [LetterheadController::class, 'preview']);
            Route::post('/letterheads', [LetterheadController::class, 'store']);
            Route::put('/letterheads/{letterhead}', [LetterheadController::class, 'update']);
            Route::delete('/letterheads/{letterhead}', [LetterheadController::class, 'destroy']);
        });

        // Activity log (M8)
        Route::get('/activity-log', [ActivityLogController::class, 'index'])
            ->middleware('permission:activity-log.view');

        // Notifications (M10)
        Route::get('/notifications', [NotificationController::class, 'index']);
        Route::put('/notifications/read', [NotificationController::class, 'markRead']);
        Route::put('/notifications/read-all', [NotificationController::class, 'markAllRead']);
        Route::get('/notification-preferences', [NotificationPreferenceController::class, 'show']);
        Route::put('/notification-preferences', [NotificationPreferenceController::class, 'update']);
    });
});
