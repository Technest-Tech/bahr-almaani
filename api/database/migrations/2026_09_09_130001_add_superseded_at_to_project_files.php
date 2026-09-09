<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * "The client sent the wrong photo — ask them again."
 *
 * A document request could be answered exactly once: the upload closed it, and
 * nothing could then undo that. A blurry scan, or somebody else's ID, stayed on
 * the project for good — and worse, stayed in the translator's file list beside
 * the correct one with nothing to tell them apart. Getting the name spelling from
 * the wrong ID is precisely the failure the whole feature exists to prevent.
 *
 * Superseding rather than deleting: this is a certified-translation office, and
 * what a client handed in — including a wrong document — is part of the record of
 * the job. The row keeps its bytes; it just stops being the answer. Anyone who
 * genuinely wants it gone deletes it, and both sides now can.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('project_files', function (Blueprint $table): void {
            $table->timestampTz('superseded_at')->nullable()->after('document_request_id');
        });
    }

    public function down(): void
    {
        Schema::table('project_files', function (Blueprint $table): void {
            $table->dropColumn('superseded_at');
        });
    }
};
