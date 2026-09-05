<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Client invoicing (change request agreed 2026-09-05): pick a client, the
 * system brings the translated page counts, type the price, an invoice
 * comes out.
 *
 * `line_items` is a snapshot of the billed projects as they stood at issue —
 * codes, titles, pages — because an invoice is a historical document: project
 * data may drift afterwards, but the stored PDF and its rows must not.
 *
 * `projects.invoice_id` is the double-billing guard: a project belongs to at
 * most one invoice, and only projects with no invoice appear as billable.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Same atomic yearly sequence as project codes: INV-2026-00001.
        Schema::create('invoice_counters', function (Blueprint $table) {
            $table->integer('year')->primary();
            $table->integer('last_number')->default(0);
        });

        Schema::create('invoices', function (Blueprint $table) {
            $table->id();
            $table->string('number', 20)->unique();
            $table->foreignId('client_id')->constrained()->restrictOnDelete();
            $table->integer('total_pages');
            $table->integer('total_words')->nullable();
            // Null when the office typed a lump sum instead of a per-page rate.
            $table->decimal('unit_price', 12, 2)->nullable();
            $table->decimal('amount', 12, 2);
            $table->char('currency', 3)->default('EGP');
            $table->text('notes')->nullable();
            $table->jsonb('line_items');
            $table->string('disk_path')->nullable();
            $table->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('issued_at');
            $table->timestampsTz();

            $table->index('client_id');
        });

        Schema::table('projects', function (Blueprint $table) {
            $table->foreignId('invoice_id')->nullable()->constrained()->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('projects', function (Blueprint $table) {
            $table->dropConstrainedForeignId('invoice_id');
        });

        Schema::dropIfExists('invoices');
        Schema::dropIfExists('invoice_counters');
    }
};
