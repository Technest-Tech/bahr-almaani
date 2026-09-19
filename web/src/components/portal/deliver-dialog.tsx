"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FileText, Send } from "lucide-react";
import { api, apiForm } from "@/lib/api";
import {
  type LetterheadTemplate,
  type PlacementPages,
  type StampPosition,
  type StampPositions,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  StampPlacementButton,
  StampPlacementDialog,
} from "@/components/letterheads/stamp-placement-dialog";
import type { StampSurface } from "@/components/letterheads/stamp-positioner";

const portalAssetPath = (id: number) => `/portal/templates/${id}/asset`;

/** `pages` → the page of the document worth showing; last is the API's default. */
const pageFor = (pages: PlacementPages) => (pages === "last" ? null : 1);

/**
 * The step between choosing files and handing them over.
 *
 * It exists so the translator can put the office seal where it actually fits. They are
 * the only person who has read the document and can see that the space below the last
 * line is taken by a signature block — which is why the position is set here rather
 * than once, globally, by an admin who never sees the file.
 *
 * Positioning is optional, per file and per seal: skip it and each seal's template
 * position applies, exactly as before. Some documents carry more than one seal — the
 * office's and the sworn translator's — so every active seal has its own button, and
 * the ones already placed show faintly while the next is dragged. Whatever is set here
 * arrives with the delivery, and the PM sees it pre-filled at approval, decides which
 * seals the file actually carries, and can still move them.
 */
export function DeliverDialog({
  open,
  files,
  initialPlacements,
  onCancel,
  onConfirm,
  submitting,
  title = "تسليم الترجمة",
  description,
  confirmLabel = "تسليم",
}: {
  open: boolean;
  files: File[];
  /**
   * Seal positions already decided — the draft preview hands its file over with
   * the position the translator dragged there, so it never has to be re-dragged.
   * Read once on mount: the parent remounts this dialog per staging (via key).
   */
  initialPlacements?: Record<number, StampPositions>;
  onCancel: () => void;
  /** File index → stamp id → position. */
  onConfirm: (placements: Record<number, StampPositions>) => void;
  submitting: boolean;
  /** Reused to correct a delivery awaiting review, where "deliver" is the wrong word. */
  title?: string;
  description?: string;
  confirmLabel?: string;
}) {
  const [placements, setPlacements] = useState<Record<number, StampPositions>>(
    initialPlacements ?? {},
  );
  const [positioning, setPositioning] = useState<{
    index: number;
    stamp: LetterheadTemplate;
  } | null>(null);

  const { data } = useQuery({
    queryKey: ["portal-templates"],
    queryFn: () => api<{ data: LetterheadTemplate[] }>("/portal/templates").then((r) => r.data),
    enabled: open,
  });

  const letterheads = useMemo(() => data?.filter((t) => t.kind === "letterhead") ?? [], [data]);
  const stamps = useMemo(() => data?.filter((t) => t.kind === "stamp") ?? [], [data]);

  // The office runs one letterhead, so the page the seals are dragged onto needs no
  // choosing. Seals are another matter: each active one can be placed.
  const letterhead = letterheads[0] ?? null;

  const positionOf = (index: number, stampId: number) => placements[index]?.[stampId] ?? null;

  function savePosition(index: number, stampId: number, next: StampPosition | null) {
    setPlacements((current) => {
      const file = { ...current[index] };
      if (next === null) delete file[stampId];
      else file[stampId] = next;

      const rest = { ...current };
      if (Object.keys(file).length === 0) delete rest[index];
      else rest[index] = file;

      return rest;
    });
  }

  function loadSurface(index: number) {
    return async (pages: PlacementPages): Promise<StampSurface> => {
      const form = new FormData();
      form.append("file", files[index]);
      if (letterhead) form.append("letterhead_id", String(letterhead.id));
      const page = pageFor(pages);
      if (page !== null) form.append("page", String(page));

      const response = await apiForm<{ data: StampSurface }>("/portal/stamp-surface", form);

      return response.data;
    };
  }

  function reset() {
    setPlacements({});
    setPositioning(null);
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen && !submitting) {
            reset();
            onCancel();
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {description ??
                (files.length === 1
                  ? "سيتم تسليم الملف لمدير المشروع وإيقاف عداد الوقت."
                  : `سيتم تسليم ${files.length.toLocaleString("ar-EG")} ملفات لمدير المشروع وإيقاف عداد الوقت.`)}
            </DialogDescription>
          </DialogHeader>

          <section className="space-y-2">
            <div className="flex items-baseline gap-2">
              <h3 className="text-sm font-semibold">الملفات</h3>
              <span className="text-xs text-muted-foreground">ضبط موضع الختم اختياري</span>
            </div>

            <ul className="divide-y rounded-lg border">
              {files.map((file, index) => (
                <li
                  key={`${file.name}-${index}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5"
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-[13px]">{file.name}</span>
                  <div className="flex max-w-full flex-wrap gap-2">
                    {stamps.map((stamp) => (
                      <StampPlacementButton
                        key={stamp.id}
                        value={positionOf(index, stamp.id)}
                        label={stamps.length > 1 ? stamp.name : undefined}
                        onClick={() => setPositioning({ index, stamp })}
                        disabled={submitting}
                      />
                    ))}
                  </div>
                </li>
              ))}
            </ul>

            <p className="text-[12px] text-muted-foreground">
              {stamps.length > 1
                ? "اضبط موضع كل ختم يحمله الملف؛ الختم الذي لا تضبطه يوضع في موضع قالبه. مدير المشروع يختار الترويسة والأختام النهائية عند الاعتماد، ويصله ما ضبطته كما تركته."
                : "الترويسة والختم النهائيان يختارهما مدير المشروع عند الاعتماد؛ ما تضبطه هنا هو موضع الختم على الصفحة، ويصله كما تركته."}
            </p>
          </section>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
              إلغاء
            </Button>
            <Button onClick={() => onConfirm(placements)} loading={submitting}>
              <Send className="size-4" />
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {positioning !== null && (
        <StampPlacementDialog
          open
          onClose={() => setPositioning(null)}
          stamp={positioning.stamp}
          stampAssetPath={portalAssetPath}
          loadSurface={loadSurface(positioning.index)}
          surfaceKey={[
            "upload",
            positioning.index,
            files[positioning.index]?.name ?? "",
            files[positioning.index]?.size ?? 0,
          ].join("-")}
          value={positionOf(positioning.index, positioning.stamp.id)}
          onSave={(next) => savePosition(positioning.index, positioning.stamp.id, next)}
          // Only the seals already placed: an unplaced one may not go on this file at all.
          others={stamps
            .filter((stamp) => stamp.id !== positioning.stamp.id)
            .map((stamp) => ({ stamp, position: positionOf(positioning.index, stamp.id) }))
            .filter((other) => other.position !== null)}
          title={
            stamps.length > 1
              ? `موضع ${positioning.stamp.name} — ${files[positioning.index]?.name ?? ""}`
              : `موضع الختم — ${files[positioning.index]?.name ?? ""}`
          }
        />
      )}
    </>
  );
}
