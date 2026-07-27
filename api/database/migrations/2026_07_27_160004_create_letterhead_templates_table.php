<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('letterhead_templates', function (Blueprint $table) {
            $table->id();
            $table->string('name', 150);
            $table->string('kind', 20); // letterhead | stamp
            $table->string('disk_path', 500);
            $table->string('preview_path', 500)->nullable();
            $table->jsonb('placement')->nullable(); // stamp positioning: pages, anchor, x, y, scale
            $table->boolean('is_active')->default(true);
            $table->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $table->timestampsTz();

            $table->index(['kind', 'is_active']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('letterhead_templates');
    }
};
