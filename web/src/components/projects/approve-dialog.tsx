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

/** `pages` → the page of the document worth showing; last is the API's default. */
const pageFor = (pages: PlacementPages) => (pages === "last" ? null : 1);

/**
 * Approval carries the letterhead + stamp selection (M9): the API rejects an
 * approval without both, and the merge job reads them off the project.
 *
 * It also carries the last word on **where each seal sits**. The translator placed it
 * while they had the document in front of them, and that placement arrives here
 * pre-filled; the PM can move it, or reset it to the stamp template's own position,
 * before the file becomes a certified document. Positions are per file, because a
 * delivery round can be three separately certified documents.
 */
export function ApproveDialog({ open, projectId, onClose, onApproved }: Props) {
  const [letterheadId, setLetterheadId] = useState<number | null>(null);
  const [stampId, setStampId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [placements, setPlacements] = useState<Record<number, StampPosition | null>>({});
  const [positioning, setPositioning] = useState<ProjectFile | null>(null);

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
  const stamp = stamps.find((t) => t.id === stampId) ?? null;
  const ready = letterheadId !== null && stampId !== null;

  /** The newest round's deliverables — exactly the files the merge will letterhead. */
  const deliverables = useMemo(() => {
    const all = (project?.files ?? []).filter((f) => f.category === "deliverable");
    const latest = Math.max(0, ...all.map((f) => f.version));

    return all.filter((f) => f.version === latest);
  }, [project]);

  /** What the PM sees for a file: their own edit, else what the translator delivered. */
  const placementOf = (file: ProjectFile) =>
    file.id in placements ? placements[file.id] : file.stamp_placement;

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
          stamp_id: stampId,
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
              اختر الترويسة والختم اللذين سيُدمجان في الملف النهائي — لا يمكن الاعتماد بدونهما.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <TemplatePicker
              kind="letterhead"
              title="الترويسة"
              templates={letterheads}
              loading={isLoading}
              selectedId={letterheadId}
              onSelect={setLetterheadId}
            />
            <TemplatePicker
              kind="stamp"
              title="الختم"
              templates={stamps}
              loading={isLoading}
              selectedId={stampId}
              onSelect={setStampId}
            />

            <section className="space-y-2">
              <div className="flex items-baseline gap-2">
                <h3 className="text-sm font-semibold">موضع الختم على كل ملف</h3>
                <span className="text-xs text-muted-foreground">اختياري</span>
              </div>
              <p className="text-[13px] text-muted-foreground">
                الموضع الذي ضبطه المترجم يظهر هنا. يمكنك تعديله قبل الاعتماد، أو تركه كما هو،
                أو إعادته إلى موضع قالب الختم.
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
                    <li key={file.id} className="flex items-center gap-3 px-3 py-2.5">
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-[13px]">
                        {file.original_name}
                      </span>
                      <span className="shrink-0 text-[12px] text-muted-foreground">
                        {placementOf(file) ? "موضع مخصّص" : "موضع القالب"}
                      </span>
                      <StampPlacementButton
                        value={placementOf(file)}
                        onClick={() => setPositioning(file)}
                        disabled={stampId === null}
                      />
                    </li>
                  ))}
                </ul>
              )}

              {stampId === null && deliverables.length > 0 && (
                <p className="text-[13px] text-amber-600 dark:text-amber-400">
                  اختر الختم أولاً حتى يظهر بحجمه الحقيقي على الصفحة.
                </p>
              )}
            </section>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              إلغاء
            </Button>
            <Button
              onClick={handleApprove}
              loading={submitting}
              disabled={!ready}
              title={ready ? undefined : "اختر ترويسة وختماً أولاً"}
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
          stamp={stamp}
          stampAssetPath={(id) => `/letterheads/${id}/asset`}
          loadSurface={loadSurface(positioning.id)}
          surfaceKey={`project-${projectId}-file-${positioning.id}-lh-${letterheadId ?? "none"}`}
          value={placementOf(positioning)}
          onSave={(next) =>
            setPlacements((current) => ({ ...current, [positioning.id]: next }))
          }
          title={`موضع الختم — ${positioning.original_name}`}
        />
      )}
    </>
  );
}
