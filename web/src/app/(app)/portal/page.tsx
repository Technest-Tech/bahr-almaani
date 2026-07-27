"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, useSyncExternalStore } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Globe,
  Inbox,
  Send,
  Timer,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, downloadFile, getToken } from "@/lib/api";
import { formatDuration, formatRelative, dateTimeFormatter } from "@/lib/format";
import {
  PRIORITY_LABELS,
  PRIORITY_TONES,
  STATUS_TONES,
  type Assignment,
  type Paginated,
  type Project,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { ToneBadge } from "@/components/tone-badge";
import { useConfirm } from "@/components/confirm";

interface CurrentResponse {
  data: Assignment | null;
  revision_note?: { note: string; by: string; at: string } | null;
}

export default function PortalPage() {
  const queryClient = useQueryClient();

  const { data: current, isLoading: loadingCurrent } = useQuery({
    queryKey: ["portal-current"],
    queryFn: () => api<CurrentResponse>("/portal/current"),
    refetchInterval: 15_000,
  });

  const busy = !!current?.data;

  const { data: queue, isLoading: loadingQueue } = useQuery({
    queryKey: ["portal-queue"],
    queryFn: () => api<Paginated<Project>>("/portal/queue"),
    refetchInterval: 15_000,
  });

  const { data: history } = useQuery({
    queryKey: ["portal-history"],
    queryFn: () => api<Paginated<Assignment>>("/portal/history"),
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["portal-current"] });
    queryClient.invalidateQueries({ queryKey: ["portal-queue"] });
    queryClient.invalidateQueries({ queryKey: ["portal-history"] });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="بورتال المترجم"
        description="الملفات مرتبة تلقائياً: العاجل أولاً ثم الأقرب موعداً — ملف واحد قيد التنفيذ في كل وقت."
      />

      {loadingCurrent ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : current?.data ? (
        <CurrentAssignmentCard
          assignment={current.data}
          revisionNote={current.revision_note}
          onDelivered={invalidateAll}
        />
      ) : null}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Inbox className="size-4 text-primary" />
            الملفات المتاحة
            <span className="text-sm font-normal text-muted-foreground">
              ({queue?.meta.total ?? 0})
            </span>
          </h2>
        </div>

        {loadingQueue && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-44 rounded-xl" />
            ))}
          </div>
        )}

        {!loadingQueue && queue?.data.length === 0 && (
          <Card className="border-dashed bg-transparent py-10 shadow-none">
            <CardContent className="text-center text-sm text-muted-foreground">
              لا توجد ملفات متاحة لأزواج لغاتك حالياً — ستصلك إشعارات فور توفر ملفات جديدة.
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {queue?.data.map((project) => (
            <QueueCard
              key={project.id}
              project={project}
              disabled={busy}
              onClaimed={invalidateAll}
            />
          ))}
        </div>
      </section>

      {!!history?.data.length && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <CheckCircle2 className="size-4 text-primary" />
            أعمالي السابقة
          </h2>
          <Card className="gap-0 py-0">
            <CardContent className="p-0">
              <ul className="divide-y">
                {history.data.map((assignment) => (
                  <li key={assignment.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {assignment.project?.title}
                      </p>
                      <p dir="ltr" className="text-start font-mono text-xs text-muted-foreground">
                        {assignment.project?.code}
                      </p>
                    </div>
                    {assignment.project && (
                      <ToneBadge tone={STATUS_TONES[assignment.project.status]}>
                        {assignment.project.status_label}
                      </ToneBadge>
                    )}
                    {assignment.status === "withdrawn" ? (
                      <ToneBadge tone="slate">مسحوب</ToneBadge>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Timer className="size-3.5" />
                        {formatDuration(assignment.work_seconds ?? 0)}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {assignment.delivered_at &&
                        dateTimeFormatter.format(new Date(assignment.delivered_at))}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}

function subscribeEveryMinute(callback: () => void) {
  const interval = setInterval(callback, 60_000);
  return () => clearInterval(interval);
}

function ElapsedTimer({ since }: { since: string }) {
  // Minute-floored snapshot: stable within each minute, pure during render.
  const seconds = useSyncExternalStore(
    subscribeEveryMinute,
    () => Math.floor(Math.max(0, Date.now() - new Date(since).getTime()) / 60_000) * 60,
    () => 0,
  );

  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-sm font-semibold text-primary">
      <Timer className="size-4" />
      {formatDuration(seconds)}
    </span>
  );
}

function CurrentAssignmentCard({
  assignment,
  revisionNote,
  onDelivered,
}: {
  assignment: Assignment;
  revisionNote?: { note: string; by: string; at: string } | null;
  onDelivered: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { confirm } = useConfirm();
  const [uploading, setUploading] = useState(false);
  const project = assignment.project!;

  async function handleDeliver(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const confirmed = await confirm({
      title: "تسليم الترجمة؟",
      description: `سيتم تسليم «${file.name}» لمدير المشروع وإيقاف عداد الوقت.`,
      confirmLabel: "تسليم",
    });
    if (!confirmed) {
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
      const response = await fetch(`${API_URL}/portal/deliver`, {
        method: "POST",
        headers: { Accept: "application/json", Authorization: `Bearer ${getToken()}` },
        body: formData,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new ApiError(response.status, body.message ?? "فشل التسليم");
      }
      toast.success("تم تسليم الترجمة — شكراً لك 🎉");
      onDelivered();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل التسليم");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <Card className="gap-0 overflow-hidden border-primary/30 py-0 shadow-md shadow-primary/5">
      <CardHeader className="flex-row items-center justify-between border-b bg-primary/5 py-4!">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Clock className="size-4 text-primary" />
          ملفك الحالي
          <ToneBadge tone={PRIORITY_TONES[project.priority]}>
            {PRIORITY_LABELS[project.priority]}
          </ToneBadge>
          {revisionNote && <ToneBadge tone="red">مطلوب تعديل</ToneBadge>}
        </CardTitle>
        <ElapsedTimer since={assignment.claimed_at!} />
      </CardHeader>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">{project.title}</h3>
            <p dir="ltr" className="text-start font-mono text-xs text-muted-foreground">
              {project.code}
            </p>
          </div>
          <div className="text-end text-sm">
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <Globe className="size-3.5" />
              {project.source_language?.name_ar} ← {project.target_language?.name_ar}
            </p>
            <p
              className={`mt-1 flex items-center gap-1.5 text-xs ${
                project.is_late ? "font-semibold text-destructive" : "text-muted-foreground"
              }`}
            >
              {project.is_late && <AlertTriangle className="size-3.5" />}
              التسليم {formatRelative(project.deadline_at)} —{" "}
              {dateTimeFormatter.format(new Date(project.deadline_at))}
            </p>
          </div>
        </div>

        {revisionNote && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="mb-1 text-xs font-semibold text-destructive">
              ملاحظات المراجعة — {revisionNote.by}
            </p>
            {revisionNote.note}
          </div>
        )}

        {project.instructions && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
            <p className="mb-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
              تعليمات خاصة
            </p>
            {project.instructions}
          </div>
        )}

        {!!project.files?.length && (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">ملفات المشروع</p>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {project.files
                .filter((f) => f.category === "source" || f.category === "reference")
                .map((file) => (
                  <li
                    key={file.id}
                    className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2"
                  >
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span dir="ltr" className="min-w-0 flex-1 truncate text-start text-xs font-medium">
                      {file.original_name}
                    </span>
                    <ToneBadge tone={file.category === "source" ? "teal" : "slate"}>
                      {file.category === "source" ? "عمل" : "مرجع"}
                    </ToneBadge>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title="تحميل"
                      onClick={() =>
                        downloadFile(`/portal/files/${file.id}/download`, file.original_name)
                          .catch(() => toast.error("تعذر تحميل الملف"))
                      }
                    >
                      <Download className="size-3.5" />
                    </Button>
                  </li>
                ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end border-t pt-4">
          <input ref={inputRef} type="file" hidden onChange={handleDeliver} />
          <Button size="lg" loading={uploading} onClick={() => inputRef.current?.click()}>
            <Send className="size-4" />
            {revisionNote ? "تسليم التعديل" : "تسليم الترجمة"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function QueueCard({
  project,
  disabled,
  onClaimed,
}: {
  project: Project;
  disabled: boolean;
  onClaimed: () => void;
}) {
  const claimMutation = useMutation({
    mutationFn: () => api(`/portal/claim/${project.id}`, { method: "POST" }),
    onSuccess: () => {
      toast.success(`استلمت «${project.title}» — بالتوفيق 💪`);
      onClaimed();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "تعذر الاستلام");
      onClaimed(); // refresh — someone else likely took it
    },
  });

  return (
    <Card className="group flex flex-col gap-0 py-0 transition-all hover:-translate-y-0.5 hover:shadow-md">
      <CardContent className="flex-1 space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <ToneBadge tone={PRIORITY_TONES[project.priority]}>
            {PRIORITY_LABELS[project.priority]}
          </ToneBadge>
          <span
            className={`text-xs ${
              project.is_late ? "font-semibold text-destructive" : "text-muted-foreground"
            }`}
          >
            {formatRelative(project.deadline_at)}
          </span>
        </div>
        <div>
          <h3 className="font-semibold leading-snug">{project.title}</h3>
          <p dir="ltr" className="mt-0.5 text-start font-mono text-[11px] text-muted-foreground">
            {project.code}
          </p>
        </div>
        <div className="space-y-1 text-xs text-muted-foreground">
          <p className="flex items-center gap-1.5">
            <Globe className="size-3.5" />
            {project.source_language?.name_ar} ← {project.target_language?.name_ar}
          </p>
          <p className="flex items-center gap-1.5">
            <FileText className="size-3.5" />
            {project.total_words
              ? `${project.total_words.toLocaleString("ar-EG")} كلمة`
              : "عدد الكلمات غير محدد"}
            {project.total_pages ? ` · ${project.total_pages.toLocaleString("ar-EG")} صفحة` : ""}
          </p>
        </div>
      </CardContent>
      <div className="border-t p-3">
        <Button
          className="w-full"
          size="sm"
          loading={claimMutation.isPending}
          disabled={disabled}
          title={disabled ? "سلّم ملفك الحالي أولاً" : undefined}
          onClick={() => claimMutation.mutate()}
        >
          استلام الملف
        </Button>
      </div>
    </Card>
  );
}
