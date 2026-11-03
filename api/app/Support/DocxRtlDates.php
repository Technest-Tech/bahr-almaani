<?php

namespace App\Support;

use Throwable;
use ZipArchive;

/**
 * Makes LibreOffice show a date in Arabic text the way Word does.
 *
 * Why this exists: a translator types «تاريخ الفاتورة: 10/08/2026» in an Arabic run
 * and Word shows 2026/08/10 — inside a run it marks right-to-left (`<w:rtl/>`), Word
 * lets the slash take the run's direction, so the numbers line up right to left.
 * LibreOffice follows the Unicode bidi algorithm to the letter, where a slash between
 * two numbers joins them into one left-to-right number, and shows 10/08/2026. Same
 * text, mirrored date, on a certified document; the office caught it on
 * BM-2026-00600 (2026-10-29).
 *
 * A right-to-left mark (U+200F) on each side of the slash gives it the run's direction
 * in LibreOffice too, which reproduces Word's layout exactly (checked against
 * Gotenberg 8). The mark is invisible and has no width.
 *
 * Deliberately narrow, because only this case is confirmed against Word:
 *   - only runs Word itself marks right-to-left;
 *   - only a slash with an ASCII digit beside it — a date split across two runs
 *     ("10/" + "08/2026") still has a digit on one side of each slash;
 *   - decimals and thousands (29.700, 920,700) are left alone, as Word leaves them.
 *
 * Conversion only, like App\Support\DocxPageMargins: the stored deliverable is never
 * rewritten, so counting and the translator's own file are unaffected. Never throws.
 */
class DocxRtlDates
{
    private const RLM = "\u{200F}";

    /** The parts whose text Word lays out on the page: the body, headers and footers. */
    private const PARTS = '#^word/(document|header\d+|footer\d+)\.xml$#';

    /**
     * @param  string  $docx  the raw .docx bytes
     * @return string|null the rewritten .docx, or null when no date needed marking
     */
    public static function apply(string $docx): ?string
    {
        $path = tempnam(sys_get_temp_dir(), 'bahr-docx-').'.docx';

        try {
            if (@file_put_contents($path, $docx) === false) {
                return null;
            }

            $zip = new ZipArchive;

            if ($zip->open($path) !== true) {
                return null;
            }

            $changed = false;

            for ($index = 0; $index < $zip->numFiles; $index++) {
                $name = (string) $zip->getNameIndex($index);
                $xml = preg_match(self::PARTS, $name) ? $zip->getFromName($name) : false;

                if (! is_string($xml)) {
                    continue;
                }

                $patched = self::mark($xml);

                if ($patched !== $xml && $zip->addFromString($name, $patched)) {
                    $changed = true;
                }
            }

            $zip->close();

            if (! $changed) {
                return null;
            }

            $bytes = @file_get_contents($path);

            return $bytes === false ? null : $bytes;
        } catch (Throwable) {
            return null;
        } finally {
            @unlink($path);
            @unlink(substr($path, 0, -5));
        }
    }

    /** Mark the date slashes in every right-to-left run of one XML part. */
    private static function mark(string $xml): string
    {
        return preg_replace_callback(
            // A run: `<w:r>` or `<w:r …>`, never `<w:rPr>` / `<w:rtl/>`.
            '#<w:r(?:\s[^>]*)?>.*?</w:r>#s',
            fn (array $run): string => self::isRightToLeft($run[0])
                ? preg_replace_callback(
                    '#(<w:t(?:\s[^>]*)?>)([^<]*)(</w:t>)#',
                    fn (array $text): string => $text[1]
                        .preg_replace('#(?<=[0-9])/|/(?=[0-9])#', self::RLM.'/'.self::RLM, $text[2])
                        .$text[3],
                    $run[0],
                ) ?? $run[0]
                : $run[0],
            $xml,
        ) ?? $xml;
    }

    /** `<w:rtl/>`, or `<w:rtl w:val="1|true|on"/>`; an explicit off is not. */
    private static function isRightToLeft(string $run): bool
    {
        return preg_match('#<w:rtl(?:\s+w:val="(?:1|true|on)")?\s*/>#', $run) === 1;
    }
}
