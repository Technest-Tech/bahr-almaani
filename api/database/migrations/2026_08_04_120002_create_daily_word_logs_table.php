<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * What the translator says they produced on a given day.
     *
     * Deliberately NOT the same number as the system's own count: the system
     * knows words per *delivery*, so a file claimed Monday and delivered
     * Thursday lands entirely on Thursday. This table is the translator's own
     * account of the day, and the report shows the two side by side — the gap
     * between them is the point.
     *
     * One row per translator per day; re-submitting a day overwrites it.
     */
    public function up(): void
    {
        Schema::create('daily_word_logs', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->date('work_date');
            $table->unsignedInteger('declared_words');
            $table->text('note')->nullable();
            $table->timestampsTz();

            $table->unique(['user_id', 'work_date']);
            $table->index('work_date');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('daily_word_logs');
    }
};
