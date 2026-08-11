const relativeFormatter = new Intl.RelativeTimeFormat("ar", { numeric: "always" });

export const dateTimeFormatter = new Intl.DateTimeFormat("ar-EG", {
  dateStyle: "medium",
  timeStyle: "short",
});

/** "٣ س ٢٥ د" — work duration from seconds. */
export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours === 0 && minutes === 0) return "أقل من دقيقة";
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours.toLocaleString("ar-EG")} س`);
  if (minutes > 0) parts.push(`${minutes.toLocaleString("ar-EG")} د`);
  return parts.join(" ");
}

/**
 * Fold the spelling differences Arabic typists actually make (hamza forms, ة/ه,
 * ى/ي, diacritics, tatweel) so local matching is as forgiving as Meilisearch is
 * server-side — otherwise "ترويسه" would miss "الترويسات".
 */
export function normalizeArabic(value: string): string {
  return value
    .replace(/[ً-ْـ]/g, "") // diacritics + tatweel
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[ىي]/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .toLowerCase();
}

/** Levenshtein distance, bailing out as soon as it exceeds `max`. */
function withinEditDistance(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    if (Math.min(...current) > max) return false;
    previous = current;
  }

  return previous[b.length] <= max;
}

/** Words are also matched with the definite article dropped ("الترويسات" → "ترويسات"). */
const stripDefiniteArticle = (word: string) =>
  word.startsWith("ال") && word.length > 3 ? word.slice(2) : word;

/**
 * Forgiving local match for short label lists (command-palette navigation): folds
 * Arabic spelling variants, then allows one typo against each word's leading
 * slice — so "ترويسه" still finds "الترويسات والأختام", the way Meilisearch would.
 */
export function looseMatch(haystack: string, needle: string): boolean {
  const target = normalizeArabic(haystack);
  const query = normalizeArabic(needle).trim();

  if (!query) return true;
  if (target.includes(query)) return true;
  if (query.length < 4) return false;

  return target
    .split(/\s+/)
    .flatMap((word) => [word, stripDefiniteArticle(word)])
    .some((word) => withinEditDistance(word.slice(0, query.length), query, 1));
}

/** "١٧٫٦ م.ب" — file size, matching the units already used on the project page. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} م.ب`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} ك.ب`;
  return `${bytes} بايت`;
}

/** "١٫٢ م.ب/ث" — transfer rate. */
export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "—";
  return `${formatBytes(bytesPerSecond)}/ث`;
}

/**
 * "28 ثانية متبقية" — time remaining.
 *
 * Latin digits on purpose. This sits on the same line as formatBytes/formatSpeed,
 * which are Latin, and mixing the two numeral systems inside one RTL text run makes
 * the bidi algorithm reorder them — "١٨" rendered as "٨١" on the first pass.
 *
 * Deliberately coarse above a minute: a jittery "47 ثانية → 51 ثانية" reads as the
 * system guessing, which is worse than no estimate at all.
 */
export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return `${Math.ceil(seconds)} ثانية متبقية`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} دقيقة متبقية`;
  return `${Math.ceil(minutes / 60)} ساعة متبقية`;
}

/** "بعد ٥ ساعات" / "قبل ٣ أيام" — relative to now. */
export function formatRelative(iso: string): string {
  const diffSeconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diffSeconds);
  if (abs < 3600) return relativeFormatter.format(Math.round(diffSeconds / 60), "minute");
  if (abs < 86400) return relativeFormatter.format(Math.round(diffSeconds / 3600), "hour");
  return relativeFormatter.format(Math.round(diffSeconds / 86400), "day");
}
