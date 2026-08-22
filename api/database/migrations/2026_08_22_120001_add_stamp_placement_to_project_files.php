<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Where this document's stamp goes, when the template's own position will not do.
 *
 * Contract item 9 promises «إمكانية تحديد موضع الختم», and until now that meant one
 * position per stamp template, set by an admin: every document carrying that seal got
 * it in the same spot. That only works while every deliverable has free space in the
 * same place, which is not true of real documents — a one-page birth certificate and a
 * twelve-page lease have nothing in common below the last line.
 *
 * It lives on the FILE, not the project, because a delivery round is not one document.
 * A translator hands back a passport, a licence and a contract for the same visa
 * application; each is separately certified and gets its own letterheaded PDF
 * (MergeFinalFileJob::latestRound), and each has its blank space somewhere else. One
 * position per project would have reproduced the very problem this fixes, one level up.
 *
 * Only a `deliverable` row ever carries a value — it is the file the seal is stamped
 * onto. NULL means "use the stamp template's own placement", which is every row that
 * exists today, so nothing already delivered changes shape. The value is stored as
 * App\Support\PlacementConfig::normalize($value, 'stamp') so the merge job never has to
 * guess a missing key.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('project_files', function (Blueprint $table): void {
            $table->jsonb('stamp_placement')->nullable()->after('count_status');
        });
    }

    public function down(): void
    {
        Schema::table('project_files', function (Blueprint $table): void {
            $table->dropColumn('stamp_placement');
        });
    }
};
