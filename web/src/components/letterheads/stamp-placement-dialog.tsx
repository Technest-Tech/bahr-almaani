"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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
import { sealOnPage, sealRectMm } from "@/lib/placement";
import { cn } from "@/lib/utils";

const PAGE_CHOICES: PlacementPages[] = ["last", "first", "all"];

/** Another seal on the same document, and where it currently sits (null = its template's). */
export interface OtherSeal {
  stamp: LetterheadTemplate;
  position: StampPosition | null;
}

/**
 * "Put the seal here" — the dialog both roles use.
 *
 * The translator opens it on a file they are about to deliver; the PM opens it at
 * approval on a file already delivered. Same surface, same geometry, same stored
 * value, so the two can never disagree about where the seal is going. What differs
 * is only where the page image comes from, which is why `loadSurface` is a prop.
 *
 * One seal is placed at a time. When the document carries others they are drawn
 * faintly where they will land, so a second seal is not dropped on top of the first.
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
  others = [],
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
  /** The document's other seals, shown faintly where they will land. */
  others?: OtherSeal[];
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
          >
            {others.map((other) => (
              <FaintSeal
                key={other.stamp.id}
                seal={other}
                surface={surface}
                assetPath={stampAssetPath}
              />
            ))}
          </StampPositioner>
        ) : (
          <Skeleton className="mx-auto aspect-[210/297] w-full max-w-md rounded-md" />
        )}

        {others.length > 0 && (
          <p className="text-[12px] text-muted-foreground">
            الأختام الأخرى على هذا الملف تظهر باهتة في مواضعها، حتى لا يوضع ختم فوق آخر.
          </p>
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

/**
 * Another seal on the document, drawn where the merge will put it. Not draggable —
 * each seal is placed in its own dialog — and hidden on a page it is not drawn on.
 */
function FaintSeal({
  seal,
  surface,
  assetPath,
}: {
  seal: OtherSeal;
  surface: StampSurface;
  assetPath: (id: number) => string;
}) {
  const { src } = useTemplateAsset(seal.stamp.id, assetPath);
  const imageRef = useRef<HTMLImageElement>(null);
  const [ratio, setRatio] = useState<number | null>(null);

  // Same as the positioner: a cached image fires no load event.
  useEffect(() => {
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth > 0) {
      setRatio(image.naturalHeight / image.naturalWidth);
    }
  }, [src]);

  const pages = seal.position?.pages ?? seal.stamp.placement.pages;
  if (!src || !sealOnPage(pages, surface.page, surface.pages)) return null;

  const rect = sealRectMm(seal.stamp.placement, seal.position, surface, ratio ?? 1);

  return (
    // eslint-disable-next-line @next/next/no-img-element -- streamed asset
    <img
      ref={imageRef}
      src={src}
      alt=""
      title={seal.stamp.name}
      onLoad={(event) =>
        setRatio(event.currentTarget.naturalHeight / event.currentTarget.naturalWidth)
      }
      className="pointer-events-none absolute select-none opacity-40 grayscale"
      draggable={false}
      style={{
        left: `${(rect.x / surface.width_mm) * 100}%`,
        top: `${(rect.y / surface.height_mm) * 100}%`,
        width: `${(rect.width / surface.width_mm) * 100}%`,
        // Its height is unknown until the image loads, and a bottom-anchored seal
        // would sit in the wrong place until then.
        visibility: ratio === null ? "hidden" : "visible",
      }}
    />
  );
}

/**
 * The button that opens the dialog, showing whether a position has been set.
 *
 * `label` names the seal when a document carries more than one, so each button says
 * which seal it places.
 */
export function StampPlacementButton({
  value,
  onClick,
  disabled,
  label,
}: {
  value: StampPosition | null;
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {

  return (
    <Button
      type="button"
      variant={value ? "secondary" : "outline"}
      size="sm"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className="max-w-full"
    >
      <Stamp className="size-4 shrink-0" />
      <span className="truncate">
        {value
          ? label
            ? `${label}: مضبوط`
            : "الختم مضبوط"
          : `ضبط موضع ${label ?? "الختم"}`}
      </span>
    </Button>
  );
}
