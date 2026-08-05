"use client";

import { useEffect, useState } from "react";
import { FileWarning } from "lucide-react";
import { fetchBlob } from "@/lib/api";
import type { LetterheadTemplate } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Template assets live on the private disk behind a bearer token, so previews are
 * fetched as blobs and handed to the browser as object URLs (revoked on unmount).
 */
export function useTemplateAsset(
  templateId: number | null,
  /** Translators have no letterheads.view, so the portal reads its own route. */
  assetPath: (id: number) => string = (id) => `/letterheads/${id}/asset`,
): {
  src: string | null;
  failed: boolean;
} {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (templateId === null) return;

    let objectUrl: string | null = null;
    let cancelled = false;

    (async () => {
      try {
        const blob = await fetchBlob(assetPath(templateId));
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // assetPath is a stable per-caller closure; keying on the id is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  return { src, failed };
}

/**
 * Renders an image template directly; PDFs render their first page in a frame.
 * Letterheads are drawn on white paper sized to the sheet (they cover the page);
 * stamps keep the transparent checkerboard behind them (they overlay it).
 */
export function TemplateAsset({
  template,
  className,
  assetPath,
}: {
  template: LetterheadTemplate;
  className?: string;
  assetPath?: (id: number) => string;
}) {
  const { src, failed } = useTemplateAsset(template.id, assetPath);
  const paper = template.kind === "letterhead";

  if (failed) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-1.5 text-muted-foreground",
          className,
        )}
      >
        <FileWarning className="size-5" />
        <span className="text-[11px]">تعذّر تحميل المعاينة</span>
      </div>
    );
  }

  if (!src) return <Skeleton className={cn("size-full", className)} />;

  if (template.mime_type === "pdf") {
    return (
      <iframe
        src={`${src}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
        title={template.name}
        tabIndex={-1}
        className={cn(
          "pointer-events-none border-0 bg-white",
          paper ? "aspect-[210/297] h-full w-auto shadow-sm" : "size-full",
          className,
        )}
      />
    );
  }

  return (
    // Blob URL from an authenticated fetch — next/image cannot optimize it.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={template.name}
      className={cn(
        paper ? "h-full w-auto bg-white object-contain shadow-sm" : "size-full object-contain",
        className,
      )}
    />
  );
}
