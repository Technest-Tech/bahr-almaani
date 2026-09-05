<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A second set of cached totals, counted from what the translator handed back
 * instead of what the client sent in.
 *
 * The office asked (2026-09-05) for reports to state the translated figures —
 * the words and pages of the delivered files. The source totals cannot simply
 * change meaning: they drive the quote, and a quote is priced before any
 * translation exists. So the two bases live side by side: `total_*` stays the
 * source (quoting), `delivered_*` is the latest delivery round (reporting).
 *
 * Pages come from the certified final PDFs when they exist — that is the
 * document the client receives, and the letterhead band repaginates, so the
 * translator's .docx page count can honestly differ from it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('projects', function (Blueprint $table): void {
            $table->integer('delivered_words')->nullable()->after('total_chars');
            $table->integer('delivered_pages')->nullable()->after('delivered_words');
            $table->integer('delivered_chars')->nullable()->after('delivered_pages');
        });
    }

    public function down(): void
    {
        Schema::table('projects', function (Blueprint $table): void {
            $table->dropColumn(['delivered_words', 'delivered_pages', 'delivered_chars']);
        });
    }
};
