<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('translator_language_pairs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('source_language_id')->constrained('languages')->restrictOnDelete();
            $table->foreignId('target_language_id')->constrained('languages')->restrictOnDelete();
            $table->timestampsTz();

            $table->unique(['user_id', 'source_language_id', 'target_language_id'], 'unique_translator_pair');
            $table->index(['source_language_id', 'target_language_id'], 'idx_pair_lookup');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('translator_language_pairs');
    }
};
