"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FileText, Send } from "lucide-react";
import { api, apiForm } from "@/lib/api";
import {
  type LetterheadTemplate,
  type PlacementPages,
  type StampPosition,
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
 * Positioning is optional and per file: skip it and the stamp template's own position
 * applies, exactly as before. Whatever is set here arrives with the delivery, and the
 * PM sees it pre-filled at approval and can still move it.
 */
export function DeliverDialog({
  open,
  files,
  onCancel,
  onConfirm,
  submitting,
}: {
  open: boolean;
  files: File[];
  onCancel: () => void;
  onConfirm: (placements: Record<number, StampPosition>) => void;
  submitting: boolean;
}) {
  const [placements, setPlacements] = useState<Record<number, StampPosition>>({});
  const [positioning, setPositioning] = useState<number | null>(null);
  const [stampId, setStampId] = useState<number | null>(null);

  const { data } = useQuery({
    queryKey: ["portal-templates"],
    queryFn: () => api<{ data: LetterheadTemplate[] }>("/portal/templates").then((r) => r.data),
    enabled: open,
  });

  const letterheads = useMemo(() => data?.filter((t) => t.kind === "letterhead") ?? [], [data]);
  const stamps = useMemo(() => data?.filter((t) => t.kind === "stamp") ?? [], [data]);

  // The office runs one letterhead and one seal, so the common case needs no choosing.
  // The picker below only appears when there is genuinely something to choose between.
  const letterhead = letterheads[0] ?? null;
  const stamp = stamps.find((t) => t.id === stampId) ?? stamps[0] ?? null;

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
            <DialogTitle>تسليم الترجمة</DialogTitle>
            <DialogDescription>
              {files.length === 1
                ? "سيتم تسليم الملف لمدير المشروع وإيقاف عداد الوقت."
                : `سيتم تسليم ${files.length.toLocaleString("ar-EG")} ملفات لمدير المشروع وإيقاف عداد الوقت.`}
            </DialogDescription>
          </DialogHeader>

          <section className="space-y-2">
            <div className="flex items-baseline gap-2">
              <h3 className="text-sm font-semibold">الملفات</h3>
              <span className="text-xs text-muted-foreground">ضبط موضع الختم اختياري</span>
            </div>

            <ul className="divide-y rounded-lg border">
              {files.map((file, index) => (
                <li key={`${file.name}-${index}`} className="flex items-center gap-3 px-3 py-2.5">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-[13px]">{file.name}</span>
                  <span className="shrink-0 text-[12px] text-muted-foreground">
                    {placements[index] ? "موضع مخصّص" : "موضع القالب"}
                  </span>
                  <StampPlacementButton
                    value={placements[index] ?? null}
                    onClick={() => setPositioning(index)}
                    disabled={!stamp || submitting}
                  />
                </li>
              ))}
            </ul>

            {stamps.length > 1 && (
              <label className="flex items-center gap-2 text-[13px]">
                <span className="text-muted-foreground">الختم المعروض:</span>
                <select
                  className="rounded-md border bg-background px-2 py-1"
                  value={stamp?.id ?? ""}
                  onChange={(event) => setStampId(Number(event.target.value))}
                >
                  {stamps.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <p className="text-[12px] text-muted-foreground">
              الترويسة والختم النهائيان يختارهما مدير المشروع عند الاعتماد؛ ما تضبطه هنا هو موضع
              الختم على الصفحة، ويصله كما تركته.
            </p>
          </section>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
              إلغاء
            </Button>
            <Button onClick={() => onConfirm(placements)} loading={submitting}>
              <Send className="size-4" />
              تسليم
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {positioning !== null && (
        <StampPlacementDialog
          open
          onClose={() => setPositioning(null)}
          stamp={stamp}
          stampAssetPath={portalAssetPath}
          loadSurface={loadSurface(positioning)}
          surfaceKey={`upload-${positioning}-${files[positioning]?.name ?? ""}-${files[positioning]?.size ?? 0}`}
          value={placements[positioning] ?? null}
          onSave={(next) =>
            setPlacements((current) => {
              if (next === null) {
                const rest = { ...current };
                delete rest[positioning];

                return rest;
              }

              return { ...current, [positioning]: next };
            })
          }
          title={`موضع الختم — ${files[positioning]?.name ?? ""}`}
        />
      )}
    </>
  );
}
