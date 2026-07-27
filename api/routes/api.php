<?php

use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\ClientController;
use App\Http\Controllers\Api\V1\LanguageController;
use App\Http\Controllers\Api\V1\ProjectController;
use App\Http\Controllers\Api\V1\ProjectFileController;
use App\Http\Controllers\Api\V1\RoleController;
use App\Http\Controllers\Api\V1\UserController;
use App\Http\Controllers\Api\V1\UserLanguagePairController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function (): void {
    Route::post('/auth/login', [AuthController::class, 'login'])
        ->middleware('throttle:5,1');

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
        });

        Route::middleware('permission:projects.manage')->group(function (): void {
            Route::post('/projects', [ProjectController::class, 'store']);
            Route::put('/projects/{project}', [ProjectController::class, 'update']);
            Route::post('/projects/{project}/publish', [ProjectController::class, 'publish']);
            Route::post('/projects/{project}/cancel', [ProjectController::class, 'cancel']);
            Route::post('/projects/{project}/files', [ProjectFileController::class, 'store']);
            Route::delete('/projects/{project}/files/{file}', [ProjectFileController::class, 'destroy']);
            Route::put('/projects/{project}/files/{file}/manual-count', [ProjectFileController::class, 'manualCount']);
        });
    });
});
