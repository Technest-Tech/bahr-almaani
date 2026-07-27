<?php

namespace App\Services;

use Smalot\PdfParser\Parser as PdfParser;
use ZipArchive;

/**
 * Extracts word/page counts from uploaded documents.
 * DOCX: docProps/app.xml statistics, falling back to parsing document.xml.
 * PDF:  text extraction via smalot/pdfparser; empty text ⇒ scanned ⇒ not countable (OCR is Phase 2).
 */
class DocumentCounter
{
    /** @return array{countable: bool, words: int|null, pages: int|null} */
    public function count(string $absolutePath, string $extension): array
    {
        return match (strtolower($extension)) {
            'docx' => $this->countDocx($absolutePath),
            'pdf' => $this->countPdf($absolutePath),
            'txt' => $this->countText((string) file_get_contents($absolutePath)),
            default => ['countable' => false, 'words' => null, 'pages' => null],
        };
    }

    private function countDocx(string $path): array
    {
        $zip = new ZipArchive;

        if ($zip->open($path) !== true) {
            return ['countable' => false, 'words' => null, 'pages' => null];
        }

        try {
            $words = null;
            $pages = null;

            // Preferred: statistics stamped by Word/LibreOffice.
            if (($appXml = $zip->getFromName('docProps/app.xml')) !== false) {
                $props = @simplexml_load_string($appXml);
                if ($props !== false) {
                    $words = isset($props->Words) ? (int) $props->Words : null;
                    $pages = isset($props->Pages) ? (int) $props->Pages : null;
                }
            }

            // Fallback: count the actual text runs.
            if (! $words && ($docXml = $zip->getFromName('word/document.xml')) !== false) {
                $text = strip_tags(preg_replace('/<w:p[ >]/', "\n<w:p ", $docXml));
                $words = $this->wordCount($text);
            }

            return [
                'countable' => $words !== null,
                'words' => $words ?: null,
                'pages' => $pages ?: null,
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
            $words = $this->wordCount($pdf->getText());

            // A PDF with pages but (almost) no extractable text is a scan — needs OCR or manual count.
            if ($pages > 0 && $words < 3) {
                return ['countable' => false, 'words' => null, 'pages' => $pages];
            }

            return ['countable' => true, 'words' => $words, 'pages' => $pages];
        } catch (\Throwable) {
            return ['countable' => false, 'words' => null, 'pages' => null];
        }
    }

    private function countText(string $content): array
    {
        return ['countable' => true, 'words' => $this->wordCount($content), 'pages' => null];
    }

    /** Unicode-aware word count (Arabic text breaks str_word_count). */
    private function wordCount(string $text): int
    {
        $parts = preg_split('/[\s\x{200B}-\x{200D}\x{00A0}]+/u', trim($text), -1, PREG_SPLIT_NO_EMPTY);

        return $parts === false ? 0 : count($parts);
    }
}
