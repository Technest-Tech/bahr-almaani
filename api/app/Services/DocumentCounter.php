<?php

namespace App\Services;

use App\Support\Ghostscript;
use Smalot\PdfParser\Parser as PdfParser;
use ZipArchive;

/**
 * Extracts word/page/character counts from uploaded documents.
 * DOCX: docProps/app.xml statistics, falling back to parsing document.xml.
 * PDF:  text extraction via smalot/pdfparser; empty text ⇒ scanned ⇒ not countable (OCR is Phase 2).
 *       Per-glyph extraction is detected and re-read through ghostscript — see isGlyphSplit().
 *
 * Characters exclude whitespace, tatweel and Arabic diacritics — see charCount().
 */
class DocumentCounter
{
    /** @return array{countable: bool, words: int|null, pages: int|null, chars: int|null} */
    public function count(string $absolutePath, string $extension): array
    {
        return match (strtolower($extension)) {
            'docx' => $this->countDocx($absolutePath),
            'pdf' => $this->countPdf($absolutePath),
            'txt' => $this->countText((string) file_get_contents($absolutePath)),
            default => self::uncountable(),
        };
    }

    /** @return array{countable: bool, words: null, pages: int|null, chars: null} */
    private static function uncountable(?int $pages = null): array
    {
        return ['countable' => false, 'words' => null, 'pages' => $pages, 'chars' => null];
    }

    private function countDocx(string $path): array
    {
        $zip = new ZipArchive;

        if ($zip->open($path) !== true) {
            return self::uncountable();
        }

        try {
            $words = null;
            $pages = null;
            $chars = null;

            // Preferred: statistics stamped by Word/LibreOffice. Its `Characters` is
            // already the excluding-spaces figure, which is the one we bill on.
            if (($appXml = $zip->getFromName('docProps/app.xml')) !== false) {
                $props = @simplexml_load_string($appXml);
                if ($props !== false) {
                    $words = isset($props->Words) ? (int) $props->Words : null;
                    $pages = isset($props->Pages) ? (int) $props->Pages : null;
                    $chars = isset($props->Characters) ? (int) $props->Characters : null;
                }
            }

            // Fallback: count the actual text runs.
            if ((! $words || ! $chars) && ($docXml = $zip->getFromName('word/document.xml')) !== false) {
                $text = strip_tags(preg_replace('/<w:p[ >]/', "\n<w:p ", $docXml));
                $words = $words ?: $this->wordCount($text);
                $chars = $chars ?: $this->charCount($text);
            }

            return [
                'countable' => $words !== null,
                'words' => $words ?: null,
                'pages' => $pages ?: null,
                'chars' => $chars ?: null,
            ];
        } finally {
            $zip->close();
        }
    }

    private function countPdf(string $path): array
    {
        try {
            $pdf = (new PdfParser)->parseFile($path);
            $pages = count($pdf->getPages());
            $text = $pdf->getText();

            // A PDF with pages but (almost) no extractable text is a scan — needs OCR or manual count.
            if ($pages > 0 && $this->wordCount($text) < 3) {
                return self::uncountable($pages);
            }

            if ($this->isGlyphSplit($text)) {
                $rescued = Ghostscript::extractText($path);

                if ($rescued === null || $this->wordCount($rescued) < 3 || $this->isGlyphSplit($rescued)) {
                    // Better no number than a wrong one — the office bills on this.
                    // The manual-count box on the project page takes it from here.
                    return self::uncountable($pages);
                }

                $text = $rescued;
            }

            return [
                'countable' => true,
                'words' => $this->wordCount($text),
                'pages' => $pages,
                'chars' => $this->charCount($text),
            ];
        } catch (\Throwable) {
            return self::uncountable();
        }
    }

    /**
     * Has the extractor emitted one token per *glyph* instead of per word?
     *
     * smalot/pdfparser reads text as positioned runs. Some producers place every
     * Arabic letter as its own run, so the extracted text comes back as
     * "خ ي ر ا ت ب ة م ج ر ت ل ا" — thirteen tokens for two words. Splitting that on
     * whitespace counts letters, not words: a translator's 1,370-word delivery was
     * stored as 3,227, and the office reported the counts as false.
     *
     * The real word boundaries are gone at that point — a genuine space and a glyph
     * separator are both just whitespace — so the text cannot be repaired, only
     * replaced (ghostscript's txtwrite keeps word spacing intact).
     *
     * Threshold: their sound documents run 0–19% single-character tokens, the broken
     * one 77%. 40% sits well clear of both. Short extracts are exempt because a
     * handful of tokens says nothing.
     */
    private function isGlyphSplit(string $text): bool
    {
        $tokens = preg_split('/[\s\x{200B}-\x{200D}\x{00A0}]+/u', trim($text), -1, PREG_SPLIT_NO_EMPTY);

        if ($tokens === false || count($tokens) < 20) {
            return false;
        }

        $singles = 0;

        foreach ($tokens as $token) {
            if (mb_strlen($token) === 1) {
                $singles++;
            }
        }

        return ($singles / count($tokens)) > 0.4;
    }

    private function countText(string $content): array
    {
        return [
            'countable' => true,
            'words' => $this->wordCount($content),
            'pages' => null,
            'chars' => $this->charCount($content),
        ];
    }

    /**
     * Billable characters: no whitespace, no tatweel, no diacritics.
     *
     * Tatweel (ـ) only stretches a glyph and tashkeel are vowel marks — counting
     * either would inflate an Arabic document against an English one carrying the
     * same content, which is exactly the number an office bills on. This is the
     * excluding-spaces convention; Word calls it `Characters`.
     */
    private function charCount(string $text): int
    {
        $stripped = preg_replace(
            '/[\s\x{0640}\x{064B}-\x{0652}\x{0670}\x{200B}-\x{200F}\x{FEFF}]/u',
            '',
            $text,
        );

        return $stripped === null ? 0 : mb_strlen($stripped);
    }

    /** Unicode-aware word count (Arabic text breaks str_word_count). */
    private function wordCount(string $text): int
    {
        $parts = preg_split('/[\s\x{200B}-\x{200D}\x{00A0}]+/u', trim($text), -1, PREG_SPLIT_NO_EMPTY);

        return $parts === false ? 0 : count($parts);
    }
}
