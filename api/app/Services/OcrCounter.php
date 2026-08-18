<?php

namespace App\Services;

use App\Support\Ghostscript;
use App\Support\Tesseract;

/**
 * Word/character counting for scans and photos — the OCR path.
 *
 * Runs only after DocumentCounter found no text layer. PDFs are rasterised page
 * by page through ghostscript; images go straight in. Tesseract (ara+eng) reads
 * each page and only confident words are kept, so stamps and borders do not
 * become billable tokens.
 *
 * Counts produced here are estimates. Callers store them with
 * count_source = 'ocr': the UI labels them, and a typed-in manual number
 * always beats them.
 */
class OcrCounter
{
    /** Everything the office actually uploads as a "scan". */
    private const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'tif', 'tiff', 'bmp'];

    /**
     * Below this mean word confidence the document is treated as unreadable.
     * Better no number than a wrong one — the office bills on it.
     */
    private const MIN_MEAN_CONFIDENCE = 50.0;

    public function __construct(private DocumentCounter $counter) {}

    public static function supports(string $extension): bool
    {
        $extension = strtolower($extension);

        return $extension === 'pdf' || in_array($extension, self::IMAGE_EXTENSIONS, true);
    }

    public function available(): bool
    {
        return Tesseract::available();
    }

    /** @return array{countable: bool, words: int|null, pages: int|null, chars: int|null} */
    public function count(string $absolutePath, string $extension): array
    {
        $extension = strtolower($extension);

        if (! self::supports($extension) || ! $this->available()) {
            return self::uncountable();
        }

        return $extension === 'pdf'
            ? $this->countPdf($absolutePath)
            : $this->fromPageImages([$absolutePath], 1);
    }

    /** @return array{countable: bool, words: int|null, pages: int|null, chars: int|null} */
    private function countPdf(string $path): array
    {
        if (! Ghostscript::available()) {
            return self::uncountable();
        }

        $workDir = sys_get_temp_dir().'/ocr-'.bin2hex(random_bytes(8));

        if (! mkdir($workDir, 0700)) {
            return self::uncountable();
        }

        try {
            $pages = Ghostscript::rasterize($path, $workDir);

            if ($pages === null) {
                return self::uncountable();
            }

            return $this->fromPageImages($pages, count($pages));
        } finally {
            foreach (glob($workDir.'/*') ?: [] as $file) {
                @unlink($file);
            }
            @rmdir($workDir);
        }
    }

    /**
     * @param  list<string>  $imagePaths
     * @return array{countable: bool, words: int|null, pages: int|null, chars: int|null}
     */
    private function fromPageImages(array $imagePaths, int $pageCount): array
    {
        $pageTexts = [];
        $confidenceWeighted = 0.0;
        $confidenceWords = 0;

        foreach ($imagePaths as $imagePath) {
            $read = Tesseract::readImage($imagePath);

            // One unreadable page means a partial total — refuse the whole
            // document rather than store a silently short billable number.
            if ($read === null) {
                return self::uncountable($pageCount);
            }

            $pageWords = $this->counter->wordCount($read['text']);
            $pageTexts[] = $read['text'];
            $confidenceWeighted += $read['mean_confidence'] * $pageWords;
            $confidenceWords += $pageWords;
        }

        $text = implode("\n", $pageTexts);
        $words = $this->counter->wordCount($text);
        $meanConfidence = $confidenceWords > 0 ? $confidenceWeighted / $confidenceWords : 0.0;

        if ($words < 3 || $meanConfidence < self::MIN_MEAN_CONFIDENCE) {
            return self::uncountable($pageCount);
        }

        return [
            'countable' => true,
            'words' => $words,
            'pages' => $pageCount,
            'chars' => $this->counter->charCount($text),
        ];
    }

    /** @return array{countable: bool, words: null, pages: int|null, chars: null} */
    private static function uncountable(?int $pages = null): array
    {
        return ['countable' => false, 'words' => null, 'pages' => $pages, 'chars' => null];
    }
}
