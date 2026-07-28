<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * M9b — merge bookkeeping.
 *
 * A failed merge must leave the project in `approved` with a readable reason, so the
 * PM can retry from the UI (docs/02, edge case 3: "never silently completes").
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('projects', function (Blueprint $table): void {
            $table->text('merge_error')->nullable();
            $table->timestampTz('merge_attempted_at')->nullable();
            $table->unsignedSmallInteger('merge_attempts')->default(0);
        });
    }

    public function down(): void
    {
        Schema::table('projects', function (Blueprint $table): void {
            $table->dropColumn(['merge_error', 'merge_attempted_at', 'merge_attempts']);
        });
    }
};
