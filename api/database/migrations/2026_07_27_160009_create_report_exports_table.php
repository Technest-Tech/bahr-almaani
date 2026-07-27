<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('report_exports', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('report_type', 50); // translator_performance | pm_performance | monthly_summary | projects_registry
            $table->jsonb('params')->nullable();
            $table->string('format', 10); // xlsx | pdf
            $table->string('status', 20)->default('queued'); // queued | processing | done | failed
            $table->string('disk_path', 500)->nullable();
            $table->text('error')->nullable();
            $table->timestampsTz();

            $table->index(['user_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('report_exports');
    }
};
