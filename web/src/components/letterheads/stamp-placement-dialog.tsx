"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Check, RotateCcw, Stamp } from "lucide-react";
import { PLACEMENT_PAGES_LABELS, type LetterheadTemplate, type PlacementPages, type StampPosition } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useTemplateAsset } from "@/components/letterheads/template-asset";
import { StampPositioner, type StampSurface } from "@/components/letterheads/stamp-positioner";
import { cn } from "@/lib/utils";

const PAGE_CHOICES: PlacementPages[] = ["last", "first", "all"];

/**
 * "Put the seal here" — the dialog both roles use.
 *
 * The translator opens it on a file they are about to deliver; the PM opens it at
 * approval on a file already delivered. Same surface, same geometry, same stored
 * value, so the two can never disagree about where the seal is going. What differs
 * is only where the page image comes from, which is why `loadSurface` is a prop.
 */
export function StampPlacementDialog({
  open,
  onClose,
  stamp,
  stampAssetPath,
  loadSurface,
  surfaceKey,
  value,
  onSave,
  title = "موضع الختم",
  description,
}: {
  open: boolean;
  onClose: () => void;
  /** The seal being placed — its `width_mm` is what makes the preview true to size. */
  stamp: LetterheadTemplate | null;
  stampAssetPath: (id: number) => string;
  /** Fetches the page image; `pages` decides which page of the document is shown. */
  loadSurface: (pages: PlacementPages) => Promise<StampSurface>;
  /** Identifies the document being placed, so two files never share a cached page. */
  surfaceKey: string;
  value: StampPosition | null;
  onSave: (next: StampPosition | null) => void;
  title?: string;
  description?: string;
}) {
  // Seeded once, because the dialog is mounted fresh each time it is opened — the
  // callers render it conditionally. Syncing these from props in an effect instead
  // would clobber a half-finished drag on every parent re-render.
  const [draft, setDraft] = useState<StampPosition | null>(value);
  const [pages, setPages] = useState<PlacementPages>(value?.pages ?? stamp?.placement.pages ?? "last");
  const { src: stampSrc } = useTemplateAsset(open ? (stamp?.id ?? null) : null, stampAssetPath);

  // The seal's true width on paper. A full-bleed stamp (null width_mm) is not a thing
  // the office uses, but if one turns up it is treated as half the sheet rather than
  // rendered at zero and made undraggable.
  const stampWidthMm = stamp?.placement.width_mm ?? 105;

  // Rendering a page costs a Gotenberg conversion and a ghostscript pass, so each one
  // is fetched once and kept: flipping between "last" and "first" to compare is free
  // after the first look. No retry — a failed render is reported, not hammered.
  const {
    data: surface,
    isPending: loading,
    error,
  } = useQuery({
    queryKey: ["stamp-surface", surfaceKey, pages],
    queryFn: () => loadSurface(pages),
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    retry: false,
  });

  function choosePages(next: PlacementPages) {
    setPages(next);
    setDraft((current) => (current ? { ...current, pages: next } : current));
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description ??
              "اسحب الختم إلى المساحة الفارغة المناسبة. الصفحة المعروضة هي الصفحة النهائية بعد الترويسة، فما تراه هنا هو ما سيخرج في الملف المعتمد."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium">الصفحات:</span>
          {PAGE_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => choosePages(choice)}
              className={cn(
                "rounded-md border px-3 py-1 text-[13px] transition-colors",
                pages === choice
                  ? "border-primary bg-primary/10 font-medium text-primary"
                  : "hover:bg-muted",
              )}
            >
              {PLACEMENT_PAGES_LABELS[choice]}
            </button>
          ))}
        </div>

        {loading ? (
          <Skeleton className="mx-auto aspect-[210/297] w-full max-w-md rounded-md" />
        ) : error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13px]">
            {error instanceof Error ? error.message : "تعذّر تجهيز الصفحة"}
          </div>
        ) : surface && stampSrc ? (
          <StampPositioner
            surface={surface}
            stampSrc={stampSrc}
            stampWidthMm={stampWidthMm}
            value={draft}
            onChange={(next) => setDraft({ ...next, pages })}
          />
        ) : (
          <Skeleton className="mx-auto aspect-[210/297] w-full max-w-md rounded-md" />
        )}

        {!stamp && (
          <p className="text-[13px] text-amber-600 dark:text-amber-400">
            اختر ختماً أولاً حتى يظهر بحجمه الحقيقي على الصفحة.
          </p>
        )}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onSave(null);
              onClose();
            }}
            title="يعود الختم إلى الموضع المحفوظ في قالب الختم"
          >
            <RotateCcw className="size-4" />
            الموضع الافتراضي
          </Button>
          <Button
            type="button"
            disabled={!draft || !surface}
            onClick={() => {
              if (draft) onSave({ ...draft, pages });
              onClose();
            }}
          >
            <Check className="size-4" />
            تثبيت الموضع
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The button that opens the dialog, showing whether a position has been set. */
export function StampPlacementButton({
  value,
  onClick,
  disabled,
}: {
  value: StampPosition | null;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} disabled={disabled}>
      <Stamp className="size-4" />
      {value ? "الختم مضبوط" : "ضبط موضع الختم"}
    </Button>
  );
}
