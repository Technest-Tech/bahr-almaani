<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('project_counters', function (Blueprint $table) {
            $table->integer('year')->primary();
            $table->integer('last_number')->default(0);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('project_counters');
    }
};
