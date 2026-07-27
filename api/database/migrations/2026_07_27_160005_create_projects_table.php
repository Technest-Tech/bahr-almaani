<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('projects', function (Blueprint $table) {
            $table->id();
            $table->string('code', 20)->unique(); // BM-2026-00001
            $table->foreignId('client_id')->nullable()->constrained()->nullOnDelete();
            $table->string('title', 255);
            $table->foreignId('source_language_id')->constrained('languages')->restrictOnDelete();
            $table->foreignId('target_language_id')->constrained('languages')->restrictOnDelete();
            $table->string('country_code', 2)->nullable(); // document origin country
            $table->string('service_type', 30)->default('certified'); // certified | regular
            $table->string('priority', 20)->default('normal'); // normal | urgent | critical
            $table->string('status', 30)->default('draft'); // see docs/02-state-machine.md
            $table->integer('declared_pages')->nullable();
            $table->integer('total_words')->nullable();
            $table->integer('total_pages')->nullable();
            $table->timestampTz('deadline_at');
            $table->text('instructions')->nullable();
            $table->decimal('quoted_amount', 12, 2)->nullable();
            $table->char('currency', 3)->default('EGP');
            $table->foreignId('letterhead_id')->nullable()->constrained('letterhead_templates')->restrictOnDelete();
            $table->foreignId('stamp_id')->nullable()->constrained('letterhead_templates')->restrictOnDelete();
            $table->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('published_at')->nullable();
            $table->timestampTz('completed_at')->nullable();
            $table->timestampTz('cancelled_at')->nullable();
            $table->text('cancel_reason')->nullable();
            $table->timestampsTz();
            $table->softDeletesTz();

            $table->index('status');
            $table->index('deadline_at');
            $table->index('client_id');
            $table->index('created_by');
            $table->index(['status', 'priority', 'deadline_at'], 'idx_portal_ordering');
            $table->index(['source_language_id', 'target_language_id', 'status'], 'idx_portal_language_filter');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('projects');
    }
};
