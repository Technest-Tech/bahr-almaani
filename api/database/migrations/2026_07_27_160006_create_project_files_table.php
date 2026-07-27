<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('project_files', function (Blueprint $table) {
            $table->id();
            $table->foreignId('project_id')->constrained()->cascadeOnDelete();
            $table->string('category', 20); // source | reference | deliverable | final
            $table->foreignId('uploaded_by')->constrained('users')->restrictOnDelete();
            $table->string('original_name', 255);
            $table->string('disk_path', 500);
            $table->string('mime_type', 120)->nullable();
            $table->unsignedBigInteger('size_bytes')->default(0);
            $table->integer('word_count')->nullable();
            $table->integer('page_count')->nullable();
            $table->string('count_status', 20)->default('pending'); // pending | processing | done | failed | not_applicable
            $table->string('count_source', 10)->default('auto'); // auto | manual
            $table->unsignedInteger('version')->default(1);
            $table->timestampsTz();

            $table->index(['project_id', 'category']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('project_files');
    }
};
