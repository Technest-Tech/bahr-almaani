<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Supporting documents that belong to ONE file rather than to the whole project.
 *
 * `reference` files have always been project-level, which was fine while the PM was
 * the only one attaching them. It stops being fine the moment the answer to "which
 * certificate is this ID for?" matters — see the document_requests migration.
 *
 * `uploaded_by` becomes nullable because the client is now an uploader, and clients
 * do not live in `users`: they are a separate table behind a separate guard (M15,
 * config/auth.php), precisely so a client token can never satisfy `auth:sanctum`.
 * Two columns rather than a polymorphic pair — the FKs stay real, and "staff or
 * client" is the whole domain of uploaders, not an open set. Exactly one is set.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('project_files', function (Blueprint $table): void {
            $table->foreignId('parent_file_id')
                ->nullable()
                ->after('transition_id')
                ->constrained('project_files')
                ->cascadeOnDelete();

            // Which request this file answers — the audit trail, and what makes an
            // attachment visible to the client who supplied it. Distinct from the
            // parent link: the office can ask twice when a scan comes back blurry,
            // and round two's file must not read as round one's.
            $table->foreignId('document_request_id')
                ->nullable()
                ->after('parent_file_id')
                ->constrained('document_requests')
                ->nullOnDelete();

            $table->foreignId('uploaded_by_client_id')
                ->nullable()
                ->after('uploaded_by')
                ->constrained('clients')
                ->nullOnDelete();
        });

        // Postgres ALTER ... DROP NOT NULL; the foreign key itself is untouched.
        Schema::table('project_files', function (Blueprint $table): void {
            $table->unsignedBigInteger('uploaded_by')->nullable()->change();
        });
    }

    public function down(): void
    {
        // `uploaded_by` stays nullable on the way down: any file a client uploaded
        // has no `users` row to point at, so restoring NOT NULL would fail on real data.
        Schema::table('project_files', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('uploaded_by_client_id');
            $table->dropConstrainedForeignId('document_request_id');
            $table->dropConstrainedForeignId('parent_file_id');
        });
    }
};
