<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('quote_requests', function (Blueprint $table) {
            $table->id();
            // The only thing the visitor is given to come back with — random, never
            // sequential, so a reference can't be guessed by counting up from another.
            $table->string('reference', 20)->unique(); // RQ-4KX7-9M2D

            // Requester (a visitor, not a system user — no account is created).
            $table->string('name', 190);
            $table->string('email', 190);
            $table->string('phone', 30)->nullable();
            $table->string('organization', 190)->nullable();

            // What they want translated.
            $table->string('title', 255);
            $table->foreignId('source_language_id')->nullable()->constrained('languages')->nullOnDelete();
            $table->foreignId('target_language_id')->nullable()->constrained('languages')->nullOnDelete();
            $table->string('service_type', 30)->default('certified'); // certified | regular
            $table->string('priority', 20)->default('normal');        // normal | urgent | critical
            $table->integer('declared_pages')->nullable();
            $table->timestampTz('needed_by')->nullable();
            $table->text('details')->nullable();

            $table->string('status', 30)->default('new'); // see QuoteRequest::STATUS_*

            // Our answer.
            $table->decimal('quoted_amount', 12, 2)->nullable();
            $table->char('currency', 3)->default('EGP');
            $table->integer('turnaround_days')->nullable();
            $table->text('response_note')->nullable();
            $table->timestampTz('responded_at')->nullable();
            $table->foreignId('responded_by')->nullable()->constrained('users')->nullOnDelete();

            // Set when the request graduates into the operational pipeline.
            $table->foreignId('client_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('project_id')->nullable()->constrained()->nullOnDelete();

            // Light abuse trace for an endpoint anyone on the internet can POST to.
            $table->string('ip_address', 45)->nullable();
            $table->string('user_agent', 255)->nullable();

            $table->timestampsTz();
            $table->softDeletesTz();

            $table->index('status');
            $table->index('email');
            $table->index(['status', 'priority', 'created_at'], 'idx_quote_triage');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('quote_requests');
    }
};
