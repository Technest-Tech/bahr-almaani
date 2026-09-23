"use client";

import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { FilePlus, FileText, Hourglass, Replace, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { isAbort, useFileTransfer } from "@/lib/use-transfer";
import { formatRelative } from "@/lib/format";
import type { Assignment, ProjectFile, StampPositions } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/confirm";
import { DeliverDialog } from "@/components/portal/deliver-dialog";
import { tooLarge, tooLargeMessage } from "@/lib/uploads";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "قبل 0 دقيقة" reads as a glitch in the first minute after delivering. */
function deliveredAgo(iso: string): string {
  return Date.now() - new Date(iso).getTime() < 60_000 ? "سُلّم الآن" : `سُلّم ${formatRelative(iso)}`;
}

/**
 * Deliveries the PM has not opened yet — the window in which the translator can still
 * swap a wrong file, add a forgotten one or take out an extra one (docs/02 rule 6).
 *
 * Renders nothing when there is nothing to correct, which is most of the time.
 */
export function AwaitingReview({ onChanged }: { onChanged: () => void }) {
  const { data } = useQuery({
    queryKey: ["portal-deliveries"],
    queryFn: () => api<{ data: Assignment[] }>("/portal/deliveries").then((r) => r.data),
  });

  if (!data?.length) return null;

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Hourglass className="size-4 text-primary" />
        بانتظار المراجعة
        <span className="text-sm font-normal text-muted-foreground">
          ({data.length.toLocaleString("ar-EG")})
        </span>
      </h2>
      <p className="text-xs text-muted-foreground">
        سلّمت هذه الملفات ولم يفتح مدير المشروع مراجعتها بعد — يمكنك تصحيح التسليم حتى تُفتح
        المراجعة، ويصله إشعار بكل تعديل.
      </p>
      {data.map((assignment) => (
        <DeliveryCard key={assignment.id} assignment={assignment} onChanged={onChanged} />
      ))}
    </section>
  );
}

function DeliveryCard({
  assignment,
  onChanged,
}: {
  assignment: Assignment;
  onChanged: () => void;
}) {
  const project = assignment.project!;
  const files = project.files ?? [];
  // Two inputs rather than one toggled: `multiple` has to be right at the moment of
  // the click, before any state set in the same handler has rendered.
  const replaceInput = useRef<HTMLInputElement>(null);
  const addInput = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<ProjectFile | null>(null);
  const [staged, setStaged] = useState<File[]>([]);
  /** Remounts the dialog per staging, so seal positions never leak across. */
  const [round, setRound] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const { upload } = useFileTransfer();
  const { confirm } = useConfirm();

  function stage(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    if (picked.length === 0) return;

    const big = tooLarge(picked);
    if (big) {
      toast.error(tooLargeMessage(big));
      event.target.value = "";
      return;
    }

    setStaged(picked);
    setRound((value) => value + 1);
  }

  function reset() {
    setStaged([]);
    setReplacing(null);
    if (replaceInput.current) replaceInput.current.value = "";
    if (addInput.current) addInput.current.value = "";
  }

  async function submit(placements: Record<number, StampPositions>) {
    setSubmitting(true);

    const formData = new FormData();
    staged.forEach((file) => formData.append("files[]", file));
    Object.entries(placements).forEach(([index, placement]) =>
      formData.append(`stamp_placements[${index}]`, JSON.stringify(placement)),
    );
    if (replacing) formData.append("replaces", String(replacing.id));

    const label =
      staged.length === 1 ? staged[0].name : `${staged.length.toLocaleString("ar-EG")} ملفات`;

    try {
      await upload(`/portal/deliveries/${project.id}/files`, formData, label);
      toast.success(
        replacing ? "استُبدل الملف وأُبلغ مدير المشروع" : "أُضيف إلى التسليم وأُبلغ مدير المشروع",
      );
      reset();
      onChanged();
    } catch (err) {
      if (!isAbort(err)) {
        toast.error(err instanceof ApiError ? err.message : "تعذر تعديل التسليم");
        // Most likely the PM opened the review meanwhile — the card should go.
        reset();
        onChanged();
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(file: ProjectFile) {
    if (
      !(await confirm({
        title: `حذف «${file.original_name}» من التسليم؟`,
        description: "يُحذف الملف من تسليمك نهائياً ويصل إشعار لمدير المشروع.",
        confirmLabel: "حذف",
        destructive: true,
      }))
    )
      return;

    try {
      await api(`/portal/deliveries/${project.id}/files/${file.id}`, { method: "DELETE" });
      toast.success("حُذف الملف من التسليم");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذر حذف الملف");
    } finally {
      onChanged();
    }
  }

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2 border-b py-4!">
        <div className="min-w-0">
          <CardTitle className="truncate text-sm">{project.title}</CardTitle>
          <p dir="ltr" className="text-start font-mono text-xs text-muted-foreground">
            {project.code}
          </p>
        </div>
        {assignment.delivered_at && (
          <span className="text-xs text-muted-foreground">
            {deliveredAgo(assignment.delivered_at)}
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        <ul className="divide-y rounded-lg border">
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-2 px-3 py-2">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span dir="ltr" className="min-w-0 flex-1 truncate text-start text-xs font-medium">
                {file.original_name}
              </span>
              <bdi className="shrink-0 text-[11px] text-muted-foreground">
                {formatBytes(file.size_bytes)}
              </bdi>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                aria-label="استبدال"
                title="استبدال بالملف الصحيح"
                disabled={submitting}
                onClick={() => {
                  setReplacing(file);
                  replaceInput.current?.click();
                }}
              >
                <Replace className="size-3.5" />
                <span className="hidden sm:inline">استبدال</span>
              </Button>
              {/* The last file cannot go — an empty delivery would reach review. */}
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-destructive"
                disabled={submitting || files.length === 1}
                title={
                  files.length === 1 ? "لا يمكن حذف آخر ملف — استبدله بالملف الصحيح" : "حذف من التسليم"
                }
                onClick={() => remove(file)}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>

        <div className="flex justify-end">
          <input ref={replaceInput} type="file" hidden onChange={stage} />
          <input ref={addInput} type="file" hidden multiple onChange={stage} />
          <Button
            size="sm"
            variant="outline"
            disabled={submitting}
            onClick={() => {
              setReplacing(null);
              addInput.current?.click();
            }}
          >
            <FilePlus className="size-3.5" />
            إضافة ملف نسيته
          </Button>
        </div>

        <DeliverDialog
          key={round}
          open={staged.length > 0}
          files={staged}
          onCancel={reset}
          onConfirm={submit}
          submitting={submitting}
          title={replacing ? `استبدال «${replacing.original_name}»` : "إضافة إلى التسليم"}
          description={
            replacing
              ? "يحلّ الملف الجديد محل القديم في تسليمك، ويصل إشعار لمدير المشروع. عداد الوقت لا يتغير."
              : "تنضم الملفات إلى تسليمك الحالي، ويصل إشعار لمدير المشروع. عداد الوقت لا يتغير."
          }
          confirmLabel={replacing ? "استبدال" : "إضافة"}
        />
      </CardContent>
    </Card>
  );
}
