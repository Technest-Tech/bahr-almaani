<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Attachments on a revision request.
 *
 * The PM sends work back with a note; the office asked to be able to point at the
 * problem with a screenshot rather than describe it in prose. Attachments are
 * ordinary project files under a new `revision` category, so storage, the download
 * route, permissions and the upload UI all carry over unchanged.
 *
 * `transition_id` binds each attachment to the revision round it belongs to. A
 * project can go round the loop several times, and a translator reading round three
 * must not be shown the screenshots from round one.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('project_files', function (Blueprint $table): void {
            $table->foreignId('transition_id')
                ->nullable()
                ->after('project_id')
                ->constrained('status_transitions')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('project_files', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('transition_id');
        });
    }
};
