"use client";

import { useCallback } from "react";
import { ApiError, apiForm, downloadFile } from "@/lib/api";
import { useTransfers } from "@/lib/transfers";

/**
 * Uploads and downloads that show themselves in <TransferPanel>.
 *
 * Call these instead of the raw `api.ts` functions anywhere a user-visible file
 * moves; the panel, the percentage, the speed, the ETA and the cancel button all
 * come for free. The raw functions stay exported for the few places that move
 * bytes without a user waiting on them (letterhead thumbnails, PDF previews).
 */
export function useFileTransfer() {
  const { start } = useTransfers();

  const download = useCallback(
    async (path: string, filename: string): Promise<void> => {
      const controller = new AbortController();
      const handle = start({
        kind: "download",
        name: filename,
        cancel: () => controller.abort(),
      });

      try {
        await downloadFile(path, filename, {
          signal: controller.signal,
          onProgress: handle.progress,
        });
        handle.succeed();
      } catch (error) {
        if (isAbort(error)) {
          handle.cancel();
          return;
        }
        handle.fail(error instanceof Error ? error.message : "تعذر تحميل الملف");
        throw error;
      }
    },
    [start],
  );

  const upload = useCallback(
    async <T,>(path: string, form: FormData, name: string): Promise<T> => {
      const controller = new AbortController();
      const handle = start({
        kind: "upload",
        name,
        cancel: () => controller.abort(),
      });

      try {
        const result = await apiForm<T>(path, form, {
          signal: controller.signal,
          onProgress: handle.progress,
        });
        handle.succeed();
        return result;
      } catch (error) {
        if (isAbort(error)) {
          handle.cancel();
          throw error;
        }
        // A 422 is the server rejecting the file, not the transfer failing — the
        // field errors still have to reach the form, so it is rethrown either way.
        handle.fail(error instanceof ApiError ? error.message : "فشل رفع الملف");
        throw error;
      }
    },
    [start],
  );

  return { download, upload };
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
