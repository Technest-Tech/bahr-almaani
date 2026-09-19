<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Several seals on one certified document.
 *
 * Some documents go out under more than one seal — the office's and the sworn
 * translator's, or a small seal on every page and the full one on the last. A project
 * carried exactly one (`projects.stamp_id`) and each deliverable one position
 * (`project_files.stamp_placement`), so the only way to get two was to combine them
 * into one image by hand, which also tied them to the same pages.
 *
 * 1. `project_stamps` replaces `projects.stamp_id`: the seals approval chose, in the
 *    order they are drawn. restrictOnDelete keeps the old guarantee that a seal a
 *    project was certified with cannot be deleted from under it.
 * 2. `project_files.stamp_placements` replaces `stamp_placement`: one position per
 *    seal, keyed by stamp template id — two seals on one page cannot share a spot.
 *
 * Existing rows keep their meaning. A project's stamp becomes its only seal. A file's
 * position is keyed to the seal it was made for: the project's own when approval has
 * already chosen one, otherwise the seal the translator was shown while dragging —
 * the first active stamp by name, which is the one the delivery dialog displayed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('project_stamps', function (Blueprint $table): void {
            $table->foreignId('project_id')->constrained()->cascadeOnDelete();
            $table->foreignId('stamp_id')->constrained('letterhead_templates')->restrictOnDelete();
            // Later seals are drawn over earlier ones where they overlap.
            $table->unsignedSmallInteger('draw_order')->default(0);

            $table->primary(['project_id', 'stamp_id']);
            $table->index('stamp_id');
        });

        DB::statement(<<<'SQL'
            INSERT INTO project_stamps (project_id, stamp_id, draw_order)
            SELECT id, stamp_id, 0 FROM projects WHERE stamp_id IS NOT NULL
            SQL);

        Schema::table('project_files', function (Blueprint $table): void {
            $table->jsonb('stamp_placements')->nullable()->after('stamp_placement');
        });

        $shownStamp = DB::table('letterhead_templates')
            ->where('kind', 'stamp')
            ->where('is_active', true)
            ->orderBy('name')
            ->orderBy('id')
            ->value('id');

        DB::update(<<<'SQL'
            UPDATE project_files f
            SET stamp_placements = jsonb_build_object(COALESCE(p.stamp_id, ?)::text, f.stamp_placement)
            FROM projects p
            WHERE p.id = f.project_id
              AND jsonb_typeof(f.stamp_placement) = 'object'
              AND COALESCE(p.stamp_id, ?) IS NOT NULL
            SQL, [$shownStamp, $shownStamp]);

        Schema::table('project_files', function (Blueprint $table): void {
            $table->dropColumn('stamp_placement');
        });

        Schema::table('projects', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('stamp_id');
        });
    }

    /** Keeps each project's first seal and each file's position for it; the rest is lost. */
    public function down(): void
    {
        Schema::table('projects', function (Blueprint $table): void {
            $table->foreignId('stamp_id')->nullable()->after('letterhead_id')
                ->constrained('letterhead_templates')->restrictOnDelete();
        });

        DB::statement(<<<'SQL'
            UPDATE projects p
            SET stamp_id = (
                SELECT ps.stamp_id FROM project_stamps ps
                WHERE ps.project_id = p.id
                ORDER BY ps.draw_order, ps.stamp_id
                LIMIT 1
            )
            SQL);

        Schema::table('project_files', function (Blueprint $table): void {
            $table->jsonb('stamp_placement')->nullable()->after('count_status');
        });

        DB::statement(<<<'SQL'
            UPDATE project_files f
            SET stamp_placement = COALESCE(
                f.stamp_placements -> p.stamp_id::text,
                (SELECT e.value FROM jsonb_each(f.stamp_placements) e ORDER BY e.key LIMIT 1)
            )
            FROM projects p
            WHERE p.id = f.project_id AND jsonb_typeof(f.stamp_placements) = 'object'
            SQL);

        Schema::table('project_files', function (Blueprint $table): void {
            $table->dropColumn('stamp_placements');
        });

        Schema::dropIfExists('project_stamps');
    }
};
