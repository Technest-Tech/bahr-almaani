<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

class ProjectCodeGenerator
{
    /**
     * Atomic, gapless-enough yearly sequence: BM-2026-00001.
     * The upsert increments under a row lock, so concurrent creators never collide.
     */
    public function next(): string
    {
        $year = now()->year;

        $row = DB::selectOne(
            'INSERT INTO project_counters (year, last_number) VALUES (?, 1)
             ON CONFLICT (year) DO UPDATE SET last_number = project_counters.last_number + 1
             RETURNING last_number',
            [$year],
        );

        return sprintf('BM-%d-%05d', $year, $row->last_number);
    }
}
