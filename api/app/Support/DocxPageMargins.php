<?php

namespace App\Support;

use Throwable;
use ZipArchive;

/**
 * Widens a .docx's page margins so LibreOffice lays the translation out *inside*
 * the letterhead's content band, instead of the merge shrinking it in afterwards.
 *
 * Why this exists: `PlacementConfig::resolveContentRect()` fits a finished page into
 * the band by scaling it uniformly, and uniform scaling costs width as well as
 * height. With the office's real letterhead (33mm header, 27mm footer on A4) that is
 * a scale of 237/297 = 0.798 — every delivered page came out at 80% size with 21mm
 * of dead white gutter down each side, on top of the margins the document already
 * had. It reads as a small grey block floating in the middle of the sheet, which is
 * exactly the complaint.
 *
 * Reserving the band *before* conversion fixes the cause: Word files carry their own
 * page geometry, so raising `<w:pgMar w:top>` / `<w:bottom>` makes LibreOffice reflow
 * the text into the remaining area at full size and full width — the same thing the
 * office does by hand when it pastes a translation into a letterheaded template.
 *
 * Gotenberg cannot do this for us: its LibreOffice route exposes no margin fields
 * (`marginTop` and friends belong to the Chromium routes), so the geometry has to be
 * changed in the document itself.
 *
 * Two rules, both pinned by tests:
 *   1. **Never narrow.** A margin already wider than the band is the translator's
 *      choice and is left alone; only a margin that would collide is raised.
 *   2. **Never throw.** A document this cannot rewrite is still a valid deliverable —
 *      it returns null and the merge falls back to the shrink path it used before.
 *
 * Known limitation: `w:header` / `w:footer` (the distance Word draws the document's
 * *own* header and footer at) are deliberately left untouched. Translators' files
 * almost never carry one, and a document that does has content whose intended
 * position we would only be guessing at.
 */
class DocxPageMargins
{
    /** Word measures page geometry in twentieths of a point. */
    private const TWIPS_PER_MM = 1440 / 25.4;

    private const DOCUMENT = 'word/document.xml';

    /**
     * Rewrite every section's top/bottom page margin to clear the band.
     *
     * @param  string  $docx  the raw .docx bytes
     * @param  float  $topMm  header artwork height to keep clear
     * @param  float  $bottomMm  footer artwork height to keep clear
     * @return string|null the rewritten .docx, or null when nothing could be reserved
     */
    public static function reserve(string $docx, float $topMm, float $bottomMm): ?string
    {
        if ($topMm <= 0.0 && $bottomMm <= 0.0) {
            return null;
        }

        $path = tempnam(sys_get_temp_dir(), 'bahr-docx-').'.docx';

        try {
            if (@file_put_contents($path, $docx) === false) {
                return null;
            }

            $zip = new ZipArchive;

            if ($zip->open($path) !== true) {
                return null;
            }

            $xml = $zip->getFromName(self::DOCUMENT);
            $patched = is_string($xml)
                ? self::widen($xml, self::twips($topMm), self::twips($bottomMm))
                : null;

            if ($patched === null || ! $zip->addFromString(self::DOCUMENT, $patched)) {
                $zip->close();

                return null;
            }

            $zip->close();

            $bytes = @file_get_contents($path);

            return $bytes === false ? null : $bytes;
        } catch (Throwable) {
            return null;
        } finally {
            @unlink($path);
        }
    }

    /**
     * Raise the margins on every `<w:pgMar>` in the document.
     *
     * Every section gets the same treatment: a deliverable that switches to landscape
     * halfway through still has the letterhead drawn on those pages.
     *
     * @return string|null null when the document declares no page geometry at all,
     *                     which means there is nothing here we can safely reserve
     */
    private static function widen(string $xml, int $top, int $bottom): ?string
    {
        $found = 0;

        $patched = preg_replace_callback(
            '/<w:pgMar\b[^>]*>/',
            function (array $match) use ($top, $bottom, &$found): string {
                $found++;

                return self::raise(self::raise($match[0], 'top', $top), 'bottom', $bottom);
            },
            $xml,
        );

        return $patched !== null && $found > 0 ? $patched : null;
    }

    /**
     * Set one edge of a `<w:pgMar>` tag to at least $twips.
     *
     * The attribute can legitimately be absent or negative (Word allows a negative
     * bottom margin so a footer can overlap the body), so it is added when missing
     * and compared numerically rather than textually.
     */
    private static function raise(string $tag, string $edge, int $twips): string
    {
        $count = 0;

        $patched = preg_replace_callback(
            '/(\sw:'.$edge.'=")(-?\d+)(")/',
            fn (array $match): string => $match[1].max((int) $match[2], $twips).$match[3],
            $tag,
            1,
            $count,
        );

        if ($patched !== null && $count > 0) {
            return $patched;
        }

        return preg_replace('/\s*\/?>$/', ' w:'.$edge.'="'.$twips.'"/>', $tag) ?? $tag;
    }

    /** Rounded up: a margin half a twip short of the band is a margin that collides. */
    private static function twips(float $mm): int
    {
        return (int) ceil(max(0.0, $mm) * self::TWIPS_PER_MM);
    }
}
