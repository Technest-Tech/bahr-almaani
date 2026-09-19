<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A signed-in client starts a project from their own area.
 *
 * Until now the only way in was the public quote form — the same one a stranger
 * fills in — so a regular client re-typed their name and email every time and the
 * office had to convert each request into a project by hand. A client's submission
 * is now a draft project from the start, already linked to them.
 *
 * `client_submitted` marks it. It is what lets the client see a draft at all: the
 * office's own drafts stay internal, but one the client created is theirs to watch.
 *
 * `created_by` goes nullable because nobody in the office created it. It names the
 * PM who owns the project — delivery notices and deadline alerts go to them — so the
 * first PM who edits or publishes the draft takes it (ProjectController).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('projects', function (Blueprint $table): void {
            $table->boolean('client_submitted')->default(false)->after('client_id');
            $table->unsignedBigInteger('created_by')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('projects', function (Blueprint $table): void {
            $table->dropColumn('client_submitted');
            // Fails while a client submission is still unowned — take or delete it first.
            $table->unsignedBigInteger('created_by')->nullable(false)->change();
        });
    }
};
