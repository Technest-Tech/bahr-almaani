"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { BadgeCheck, FileText } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import {
  type LetterheadTemplate,
  type PlacementPages,
  type Project,
  type ProjectFile,
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
import { Skeleton } from "@/components/ui/skeleton";
import { TemplatePicker } from "@/components/letterheads/template-picker";
import {
  StampPlacementButton,
  StampPlacementDialog,
} from "@/components/letterheads/stamp-placement-dialog";
import type { StampSurface } from "@/components/letterheads/stamp-positioner";

interface Props {
  open: boolean;
  projectId: number | string;
  onClose: () => void;
  onApproved: () => void;
}

/** file id → stamp id → position; null puts that seal back at its template's position. */
type PlacementEdits = Record<number, Record<number, StampPosition | null>>;

/** `pages` → the page of the document worth showing; last is the API's default. */
const pageFor = (pages: PlacementPages) => (pages === "last" ? null : 1);

/**
 * Approval carries the letterhead selection (M9) and the seals, and since
 * 2026-09-07 both are optional: the office asked first to finish a file without
 * sealing it — "عندي القدرة أختم أو لا" — and then to deliver without a
 * letterhead at all, for work that goes out on the client's own paper.
 *
 * Since 2026-09-19 a file can carry several seals — the office's and the sworn
 * translator's, or a small seal on every page and the full one on the last. They
 * are drawn in the order picked.
 *
 * Neither is *defaulted* to «بدون», though. An empty dialog still cannot be
 * submitted: the PM clicks «بدون ترويسة» deliberately, so a stray click on a
 * dialog whose selection was simply left blank can never produce an
 * uncertified final.
 *
 * It also carries the last word on **where each seal sits**. The translator placed them
 * while they had the document in front of them, and those positions arrive here
 * pre-filled; the PM can move each one, or reset it to its template's own position,
 * before the file becomes a certified document. Positions are per file and per seal,
 * because a delivery round can be three separately certified documents, and two
 * seals on one page cannot share a spot.
 */
export function ApproveDialog({ open, projectId, onClose, onApproved }: Props) {
  const [letterheadId, setLetterheadId] = useState<number | null>(null);
  // Distinct from `letterheadId === null`, which is merely "not chosen yet".
  const [omitLetterhead, setOmitLetterhead] = useState(false);
  // In the order picked, which is the order they are drawn. Empty = «بدون ختم».
  const [stampIds, setStampIds] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  /** Only what the PM touched — anything else stays as delivered. */
  const [placements, setPlacements] = useState<PlacementEdits>({});
  const [positioning, setPositioning] = useState<{
    file: ProjectFile;
    stamp: LetterheadTemplate;
  } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["letterheads", "active"],
    queryFn: () => api<{ data: LetterheadTemplate[] }>("/letterheads?active=1").then((r) => r.data),
    enabled: open,
  });

  const { data: project, isLoading: loadingProject } = useQuery({
    queryKey: ["project", projectId, "approve"],
    queryFn: () => api<{ data: Project }>(`/projects/${projectId}`).then((r) => r.data),
    enabled: open,
  });

  const letterheads = data?.filter((t) => t.kind === "letterhead") ?? [];
  const stamps = data?.filter((t) => t.kind === "stamp") ?? [];
  const chosenStamps = stampIds
    .map((id) => stamps.find((t) => t.id === id))
    .filter((t): t is LetterheadTemplate => !!t);
  // The stamp is deliberately NOT part of readiness — approving unsealed is a
  // choice the office asked for, not a half-filled form.
  const ready = letterheadId !== null || omitLetterhead;

  /** The newest round's deliverables — exactly the files the merge will letterhead. */
  const deliverables = useMemo(() => {
    const all = (project?.files ?? []).filter((f) => f.category === "deliverable");
    const latest = Math.max(0, ...all.map((f) => f.version));

    return all.filter((f) => f.version === latest);
  }, [project]);

  /** What the PM sees for one seal on a file: their own edit, else what was delivered. */
  function placementOf(file: ProjectFile, stampId: number): StampPosition | null {
    const edited = placements[file.id];
    if (edited && stampId in edited) return edited[stampId];

    return file.stamp_placements?.[stampId] ?? null;
  }

  function toggleStamp(id: number) {
    setStampIds((current) =>
      current.includes(id) ? current.filter((other) => other !== id) : [...current, id],
    );
  }

  function loadSurface(fileId: number) {
    return async (pages: PlacementPages): Promise<StampSurface> => {
      const query = new URLSearchParams();
      if (letterheadId !== null) query.set("letterhead_id", String(letterheadId));
      const page = pageFor(pages);
      if (page !== null) query.set("page", String(page));

      const response = await api<{ data: StampSurface }>(
        `/projects/${projectId}/files/${fileId}/stamp-surface?${query}`,
      );

      return response.data;
    };
  }

  async function handleApprove() {
    if (!ready) return;
    setSubmitting(true);
    try {
      await api(`/projects/${projectId}/review/approve`, {
        method: "POST",
        json: {
          letterhead_id: letterheadId,
          stamp_ids: stampIds,
          // Only what the PM actually touched: anything omitted stays as delivered.
          ...(Object.keys(placements).length > 0 ? { stamp_placements: placements } : {}),
        },
      });
      toast.success("تم الاعتماد — جارِ تجهيز الملف النهائي");
      onApproved();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.errors
          ? Object.values(err.errors)[0][0]
          : err instanceof Error
            ? err.message
            : "حدث خطأ",
      );
      setSubmitting(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>اعتماد الترجمة وإنهاء الملف</DialogTitle>
            <DialogDescription>
              اختر الترويسة والأختام التي ستُدمج في الملف النهائي. كلاهما اختياري — يمكنك
              الاعتماد بدون ترويسة أو بدون ختم أو بدونهما معاً، ويمكن وضع أكثر من ختم على الملف.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="space-y-2">
              <TemplatePicker
                kind="letterhead"
                title="الترويسة"
                templates={letterheads}
                loading={isLoading}
                selectedId={letterheadId}
                onSelect={(id) => {
                  setLetterheadId(id);
                  setOmitLetterhead(false);
                }}
              />
              <button
                type="button"
                onClick={() => {
                  setOmitLetterhead(true);
                  setLetterheadId(null);
                }}
                className={`rounded-md border px-3 py-1 text-[13px] transition-colors ${
                  omitLetterhead
                    ? "border-primary bg-primary/10 font-medium text-primary"
                    : "hover:bg-muted"
                }`}
              >
                بدون ترويسة
              </button>
            </div>
            <div className="space-y-2">
              <TemplatePicker
                kind="stamp"
                title="الأختام (اختياري)"
                templates={stamps}
                loading={isLoading}
                selectedIds={stampIds}
                onSelect={toggleStamp}
              />
              <button
                type="button"
                onClick={() => setStampIds([])}
                className={`rounded-md border px-3 py-1 text-[13px] transition-colors ${
                  stampIds.length === 0
                    ? "border-primary bg-primary/10 font-medium text-primary"
                    : "hover:bg-muted"
                }`}
              >
                بدون ختم
              </button>
            </div>

            {chosenStamps.length > 0 ? (
              <section className="space-y-2">
                <div className="flex items-baseline gap-2">
                  <h3 className="text-sm font-semibold">
                    {chosenStamps.length > 1 ? "موضع كل ختم على كل ملف" : "موضع الختم على كل ملف"}
                  </h3>
                  <span className="text-xs text-muted-foreground">اختياري</span>
                </div>
                <p className="text-[13px] text-muted-foreground">
                  الموضع الذي ضبطه المترجم يظهر هنا. يمكنك تعديله قبل الاعتماد، أو تركه كما هو،
                  أو إعادته إلى موضع قالب الختم. الختم الذي لم يُضبط يوضع في موضع قالبه.
                </p>

                {loadingProject ? (
                  <Skeleton className="h-16 rounded-lg" />
                ) : deliverables.length === 0 ? (
                  <p className="rounded-lg border px-4 py-3 text-[13px] text-muted-foreground">
                    لا توجد ملفات تسليم بعد.
                  </p>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {deliverables.map((file) => (
                      <li
                        key={file.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5"
                      >
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-[13px]">
                          {file.original_name}
                        </span>
                        <div className="flex max-w-full flex-wrap gap-2">
                          {chosenStamps.map((stamp) => (
                            <StampPlacementButton
                              key={stamp.id}
                              value={placementOf(file, stamp.id)}
                              label={chosenStamps.length > 1 ? stamp.name : undefined}
                              onClick={() => setPositioning({ file, stamp })}
                            />
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : (
              deliverables.length > 0 && (
                <p className="text-[13px] text-muted-foreground">
                  {omitLetterhead
                    ? "بدون ترويسة وبدون ختم: سيصدر الملف النهائي كترجمة عادية بصيغة PDF دون أي اعتماد."
                    : "بدون ختم: سيصدر الملف النهائي بالترويسة فقط. اختر ختماً أو أكثر أعلاه إذا أردت وضعها وضبط مواضعها."}
                </p>
              )
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              إلغاء
            </Button>
            <Button
              onClick={handleApprove}
              loading={submitting}
              disabled={!ready}
              title={ready ? undefined : "اختر ترويسة، أو «بدون ترويسة»"}
            >
              <BadgeCheck className="size-4" />
              اعتماد وإنهاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {positioning && (
        <StampPlacementDialog
          open
          onClose={() => setPositioning(null)}
          stamp={positioning.stamp}
          stampAssetPath={(id) => `/letterheads/${id}/asset`}
          loadSurface={loadSurface(positioning.file.id)}
          surfaceKey={`project-${projectId}-file-${positioning.file.id}-lh-${letterheadId ?? "none"}`}
          value={placementOf(positioning.file, positioning.stamp.id)}
          onSave={(next) => {
            const { file, stamp } = positioning;
            setPlacements((current) => ({
              ...current,
              [file.id]: { ...current[file.id], [stamp.id]: next },
            }));
          }}
          // Every other chosen seal lands on this file too, at its own position or
          // its template's — so all of them are shown, not only the moved ones.
          others={chosenStamps
            .filter((stamp) => stamp.id !== positioning.stamp.id)
            .map((stamp) => ({ stamp, position: placementOf(positioning.file, stamp.id) }))}
          title={
            chosenStamps.length > 1
              ? `موضع ${positioning.stamp.name} — ${positioning.file.original_name}`
              : `موضع الختم — ${positioning.file.original_name}`
          }
        />
      )}
    </>
  );
}
