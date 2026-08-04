<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The monthly word target a translator is measured against. Nullable on
     * purpose: a user without one simply has no target column in the report,
     * which is the correct reading for PMs, admins and new hires.
     *
     * This is a *reporting* figure, not a payroll figure — no salary, tier or
     * bonus value lives on the user (see docs/HANDOFF.md §7b).
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->unsignedInteger('monthly_word_target')->nullable()->after('locale');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->dropColumn('monthly_word_target');
        });
    }
};
