"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, BadgeCheck, Check } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import {
  PLACEMENT_ANCHOR_LABELS,
  PLACEMENT_PAGES_LABELS,
  type LetterheadTemplate,
  type TemplateKind,
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
import { TemplateAsset } from "@/components/letterheads/template-asset";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  projectId: number | string;
  onClose: () => void;
  onApproved: () => void;
}

/**
 * Approval carries the letterhead + stamp selection (M9): the API rejects an
 * approval without both, and the merge job reads them off the project.
 */
export function ApproveDialog({ open, projectId, onClose, onApproved }: Props) {
  const [letterheadId, setLetterheadId] = useState<number | null>(null);
  const [stampId, setStampId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["letterheads", "active"],
    queryFn: () =>
      api<{ data: LetterheadTemplate[] }>("/letterheads?active=1").then((r) => r.data),
    enabled: open,
  });

  const letterheads = data?.filter((t) => t.kind === "letterhead") ?? [];
  const stamps = data?.filter((t) => t.kind === "stamp") ?? [];
  const ready = letterheadId !== null && stampId !== null;

  async function handleApprove() {
    if (!ready) return;
    setSubmitting(true);
    try {
      await api(`/projects/${projectId}/review/approve`, {
        method: "POST",
        json: { letterhead_id: letterheadId, stamp_id: stampId },
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
  );
}

function TemplatePicker({
  kind,
  title,
  templates,
  loading,
  selectedId,
  onSelect,
}: {
  kind: TemplateKind;
  title: string;
  templates: LetterheadTemplate[];
  loading: boolean;
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground">القوالب الفعّالة فقط</span>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-[13px]">
          <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            لا توجد {kind === "stamp" ? "أختام" : "ترويسات"} فعّالة —{" "}
            <Link href="/letterheads" className="font-medium text-primary hover:underline">
              أضف قالباً من صفحة الترويسات والأختام
            </Link>
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {templates.map((template) => {
            const selected = selectedId === template.id;
            return (
              <button
                key={template.id}
                type="button"
                onClick={() => onSelect(template.id)}
                className={cn(
                  "group relative overflow-hidden rounded-lg border bg-card text-start transition-all",
                  selected
                    ? "border-primary ring-2 ring-primary/30"
                    : "hover:border-primary/40 hover:shadow-sm",
                )}
              >
                <div
                  className={cn(
                    "flex h-24 items-center justify-center overflow-hidden border-b p-2",
                    kind === "stamp"
                      ? "bg-[repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] bg-[length:12px_12px]"
                      : "bg-muted/50",
                  )}
                >
                  <TemplateAsset template={template} />
                </div>
                <div className="p-2">
                  <p className="truncate text-xs font-medium">{template.name}</p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {PLACEMENT_PAGES_LABELS[template.placement.pages]} ·{" "}
                    {PLACEMENT_ANCHOR_LABELS[template.placement.anchor]}
                  </p>
                </div>
                {selected && (
                  <span className="absolute top-1.5 end-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                    <Check className="size-3" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
