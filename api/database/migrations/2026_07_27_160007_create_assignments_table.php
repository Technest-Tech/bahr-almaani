<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('assignments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('project_id')->constrained()->cascadeOnDelete();
            $table->foreignId('translator_id')->constrained('users')->restrictOnDelete();
            $table->string('status', 20)->default('active'); // active | delivered | withdrawn
            $table->timestampTz('claimed_at');
            $table->timestampTz('delivered_at')->nullable();
            $table->unsignedInteger('work_seconds')->nullable(); // computed & stored at delivery
            $table->timestampTz('withdrawn_at')->nullable();
            $table->foreignId('withdrawn_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->text('withdraw_reason')->nullable();
            $table->timestampsTz();

            $table->index(['translator_id', 'status']);
            $table->index(['project_id', 'status']);
        });

        // DB-level business rules — impossible to double-claim even if app code regresses.
        // (Partial unique indexes: PostgreSQL / SQLite compatible.)
        DB::statement("CREATE UNIQUE INDEX one_active_per_translator ON assignments (translator_id) WHERE status = 'active'");
        DB::statement("CREATE UNIQUE INDEX one_active_per_project ON assignments (project_id) WHERE status = 'active'");
    }

    public function down(): void
    {
        Schema::dropIfExists('assignments');
    }
};
