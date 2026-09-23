import { formatBytes } from "@/lib/format";

/**
 * The largest file the office accepts, checked here so an oversized one is
 * refused on the spot.
 *
 * Without this the browser uploads the whole file before the server can say no —
 * a minute of progress bar ending in an error nobody can act on, which is how an
 * 82.5 MB delivery was read as "rar files don't work" (2026-09-23). The file type
 * is never the issue: archives upload fine, but they cannot be sealed, so the
 * delivery dialog says so separately.
 *
 * Keep in step with App\Support\Uploads::MAX_FILE_KB — UploadLimitsTest fails if
 * these two drift apart.
 */
export const MAX_UPLOAD_KB = 204800;

export const MAX_UPLOAD_BYTES = MAX_UPLOAD_KB * 1024;

/** The first file that is too large, or null when every one of them fits. */
export function tooLarge(files: File[], limitBytes: number = MAX_UPLOAD_BYTES): File | null {
  return files.find((file) => file.size > limitBytes) ?? null;
}

/** "«archive.rar» (٨٢٫٥ م.ب) أكبر من الحد المسموح ٢٠٠ م.ب للملف الواحد" */
export function tooLargeMessage(file: File, limitBytes: number = MAX_UPLOAD_BYTES): string {
  return `«${file.name}» (${formatBytes(file.size)}) أكبر من الحد المسموح ${formatBytes(limitBytes)} للملف الواحد`;
}

/** What a rejected upload says when the server never got far enough to explain. */
export function uploadTooLargeMessage(): string {
  return `حجم الرفع أكبر من الحد المسموح (${formatBytes(MAX_UPLOAD_BYTES)} للملف الواحد)`;
}
