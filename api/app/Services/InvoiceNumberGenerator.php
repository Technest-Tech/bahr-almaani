<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

class InvoiceNumberGenerator
{
    /**
     * Atomic, gapless-enough yearly sequence: INV-2026-00001.
     * Same shape as ProjectCodeGenerator — the upsert increments under a row
     * lock, so concurrent issuers never collide. A failed issue burns its
     * number, which an office accepts far more readily than a duplicate.
     */
    public function next(): string
    {
        $year = now()->year;

        $row = DB::selectOne(
            'INSERT INTO invoice_counters (year, last_number) VALUES (?, 1)
             ON CONFLICT (year) DO UPDATE SET last_number = invoice_counters.last_number + 1
             RETURNING last_number',
            [$year],
        );

        return sprintf('INV-%d-%05d', $year, $row->last_number);
    }
}
