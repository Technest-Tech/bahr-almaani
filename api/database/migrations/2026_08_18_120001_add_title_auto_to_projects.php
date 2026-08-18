<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Marks a title the system chose rather than the PM.
 *
 * The office asked to be able to leave the project name blank and have the first
 * uploaded file name it. The project is created before any file exists, so the
 * title is seeded with the project code and replaced when the first source file
 * arrives — this flag is what says "still ours to replace". The column stays NOT
 * NULL: twenty-five notifications, exports and events read the title straight,
 * and a nullable one would have them announcing «».
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('projects', function (Blueprint $table): void {
            $table->boolean('title_auto')->default(false)->after('title');
        });
    }

    public function down(): void
    {
        Schema::table('projects', function (Blueprint $table): void {
            $table->dropColumn('title_auto');
        });
    }
};
