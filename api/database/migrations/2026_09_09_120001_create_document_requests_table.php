<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * "This certificate needs the holder's ID attached."
 *
 * The office routinely discovers, after the file is already in the system, that a
 * document cannot be translated correctly without a second one beside it — an ID
 * card for the official spelling of a name, a licence, an old certificate. Until
 * now that conversation happened on WhatsApp and the answer arrived as a photo in
 * someone's phone, unattached to anything.
 *
 * A request names the *file* it is about, not just the project: a visa batch holds
 * four certificates for four people and "we need the ID" is meaningless without
 * saying whose. What satisfies it is one or more ordinary reference files carrying
 * `document_request_id` — plural on purpose, because a national ID is two sides.
 *
 * Deliberately NOT a project status. The state machine already carries ten of them
 * and every one is a transition the PM, the translator portal and the claim lock
 * all reason about; "waiting on the client" is a fact about a file, and the board
 * shows it as a badge derived from the open rows here.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('document_requests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('project_id')->constrained()->cascadeOnDelete();
            // The source file this is about. Nullable so a request can still be made
            // about the job as a whole, and so deleting a draft's file does not take
            // the correspondence with it.
            $table->foreignId('project_file_id')->nullable()->constrained('project_files')->nullOnDelete();
            $table->string('kind', 20); // identity | supporting
            $table->string('status', 20)->default('pending'); // pending | fulfilled | cancelled
            $table->text('note')->nullable();
            $table->foreignId('requested_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('fulfilled_at')->nullable();
            $table->timestampTz('cancelled_at')->nullable();
            $table->timestampsTz();

            // The board's "awaiting a document" badge is a lookup on exactly this.
            $table->index(['project_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('document_requests');
    }
};
