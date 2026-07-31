<?php

namespace App\Services;

use App\Models\QuoteRequest;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * Public tracking references: RQ-4KX7-9M2D.
 *
 * Unlike project codes these are NOT sequential. The reference is the only thing
 * guarding a request's page — anyone holding it sees the quote — so it must not be
 * derivable from another one. Eight characters from a 31-symbol alphabet is ~40 bits,
 * which brute-forcing can't reach through the endpoint's rate limit.
 *
 * The alphabet drops the glyphs people misread when copying a code off a screen
 * or reading it down a phone line: 0/O, 1/I/L.
 */
class QuoteReferenceGenerator
{
    private const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

    private const MAX_ATTEMPTS = 12;

    public function next(): string
    {
        for ($attempt = 0; $attempt < self::MAX_ATTEMPTS; $attempt++) {
            $reference = sprintf('RQ-%s-%s', $this->block(), $this->block());

            if (! QuoteRequest::withTrashed()->where('reference', $reference)->exists()) {
                return $reference;
            }
        }

        throw new RuntimeException('Could not allocate a unique quote reference.');
    }

    private function block(): string
    {
        $length = strlen(self::ALPHABET);

        return collect(range(1, 4))
            ->map(fn (): string => self::ALPHABET[random_int(0, $length - 1)])
            ->implode('');
    }

    /** Normalise what a visitor typed (spacing, case, a missing prefix) before lookup. */
    public static function normalize(string $input): string
    {
        $cleaned = Str::of($input)->upper()->replaceMatches('/[^A-Z0-9]/', '')->toString();

        if (str_starts_with($cleaned, 'RQ')) {
            $cleaned = substr($cleaned, 2);
        }

        if (strlen($cleaned) !== 8) {
            return Str::upper(trim($input));
        }

        return sprintf('RQ-%s-%s', substr($cleaned, 0, 4), substr($cleaned, 4, 4));
    }
}
