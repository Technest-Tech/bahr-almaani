<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Characters alongside words, because certified translation in this market is
 * frequently priced per character rather than per word.
 *
 * Excludes whitespace, tatweel and Arabic diacritics — none of those are a "letter"
 * anyone bills for, and counting them would inflate an Arabic document against an
 * English one for the same content. See App\Services\DocumentCounter::charCount().
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('project_files', function (Blueprint $table): void {
            $table->integer('char_count')->nullable()->after('page_count');
        });

        Schema::table('projects', function (Blueprint $table): void {
            $table->integer('total_chars')->nullable()->after('total_pages');
        });
    }

    public function down(): void
    {
        Schema::table('project_files', function (Blueprint $table): void {
            $table->dropColumn('char_count');
        });

        Schema::table('projects', function (Blueprint $table): void {
            $table->dropColumn('total_chars');
        });
    }
};
