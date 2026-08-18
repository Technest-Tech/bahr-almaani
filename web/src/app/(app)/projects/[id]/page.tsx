"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  BadgeCheck,
  Calculator,
  Download,
  Eye,
  FileCheck2,
  FileText,
  History,
  Paperclip,
  RotateCcw,
  Send,
  Stamp,
  Timer,
  Trash2,
  Undo2,
  Upload,
  UserRound,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { isAbort, useFileTransfer } from "@/lib/use-transfer";
import { formatDuration } from "@/lib/format";
import {
  COUNT_STATUS_LABELS,
  PRIORITY_LABELS,
  PRIORITY_TONES,
  STATUS_TONES,
  type Project,
  type ProjectFile,
  type Transition,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Field } from "@/components/field";
import { ToneBadge } from "@/components/tone-badge";
import { useConfirm } from "@/components/confirm";
import { TemplateAsset } from "@/components/letterheads/template-asset";
import { ApproveDialog } from "@/components/projects/approve-dialog";
import { RevisionRequestDialog } from "@/components/projects/revision-request-dialog";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const dateFormatter = new Intl.DateTimeFormat("ar-EG", {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * Categories that carry a word/page count.
 *
 * Source drives the quote; deliverable is what the translator actually produced,
 * and on this client's projects the source is usually a scan — so the deliverable
 * is frequently the only document in the project a machine can count.
 */
const COUNTED_CATEGORIES: ProjectFile["category"][] = ["source", "deliverable"];

function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} م.ب`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} ك.ب`;
  return `${bytes} بايت`;
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const { download } = useFileTransfer();
  const { prompt, confirm } = useConfirm();
  const queryClient = useQueryClient();
  const [countFile, setCountFile] = useState<ProjectFile | null>(null);
  const [approving, setApproving] = useState(false);
  const [requestingRevision, setRequestingRevision] = useState(false);

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", id],
    queryFn: () => api<{ data: Project }>(`/projects/${id}`).then((r) => r.data),
  });

  const { data: timeline } = useQuery({
    queryKey: ["project-timeline", id],
    queryFn: () => api<{ data: Transition[] }>(`/projects/${id}/timeline`).then((r) => r.data),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["project", id] });
    queryClient.invalidateQueries({ queryKey: ["project-timeline", id] });
    queryClient.invalidateQueries({ queryKey: ["projects"] });
  };

  const publishMutation = useMutation({
    mutationFn: () => api(`/projects/${id}/publish`, { method: "POST" }),
    onSuccess: () => {
      invalidate();
      toast.success("تم نشر المشروع — أصبح متاحاً للمترجمين");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "حدث خطأ"),
  });

  const cancelMutation = useMutation({
    mutationFn: (reason: string) =>
      api(`/projects/${id}/cancel`, { method: "POST", json: { reason } }),
    onSuccess: () => {
      invalidate();
      toast.success("تم إلغاء المشروع");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "حدث خطأ"),
  });

  const withdrawMutation = useMutation({
    mutationFn: (reason: string) =>
      api(`/projects/${id}/withdraw`, { method: "POST", json: { reason } }),
    onSuccess: () => {
      invalidate();
      toast.success("تم سحب الملف وإعادته للمتاح");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "حدث خطأ"),
  });

  const archiveMutation = useMutation({
    mutationFn: () => api(`/projects/${id}/archive`, { method: "POST" }),
    onSuccess: () => {
      invalidate();
      toast.success("تمت أرشفة المشروع");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "حدث خطأ"),
  });

  /** M9b — re-run the letterhead merge after a failure; the project stays `approved`. */
  const retryMergeMutation = useMutation({
    mutationFn: () => api(`/projects/${id}/merge/retry`, { method: "POST" }),
    onSuccess: () => {
      invalidate();
      toast.success("أُعيد تشغيل الدمج — سيظهر الملف النهائي بعد اكتماله");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "حدث خطأ"),
  });

  const reviewAction = useMutation({
    mutationFn: ({ action, note }: { action: string; note?: string }) =>
      api(`/projects/${id}/review/${action}`, { method: "POST", json: note ? { note } : undefined }),
    onSuccess: (_, { action }) => {
      invalidate();
      toast.success(
        action === "request-revision" ? "أُعيد الملف للمترجم مع الملاحظات" : "فُتحت المراجعة",
      );
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "حدث خطأ"),
  });

  if (isLoading || !project) {
    return (
      <div className="w-full space-y-6">
        <Skeleton className="h-5 w-40" />
        <div className="space-y-2">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const canManage = can("projects.manage");
  const canReview = can("projects.review");
  const sourceFiles = project.files?.filter((f) => f.category === "source") ?? [];
  const referenceFiles = project.files?.filter((f) => f.category === "reference") ?? [];
  const deliverableFiles = project.files?.filter((f) => f.category === "deliverable") ?? [];
  const finalFiles = project.files?.filter((f) => f.category === "final") ?? [];
  const assignment = project.assignment;

  return (
    <div className="w-full space-y-6">
      <Link
        href="/projects"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowRight className="size-4" />
        عودة إلى المشاريع
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{project.title}</h1>
            <ToneBadge tone={STATUS_TONES[project.status]}>{project.status_label}</ToneBadge>
            {project.is_late && (
              <ToneBadge tone="red">
                <AlertTriangle />
                متأخر
              </ToneBadge>
            )}
          </div>
          <p dir="ltr" className="mt-1 text-start font-mono text-sm text-muted-foreground">
            {project.code}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canManage && project.status === "draft" && (
            <Button
              onClick={() => publishMutation.mutate()}
              loading={publishMutation.isPending}
              disabled={sourceFiles.length === 0}
              title={sourceFiles.length === 0 ? "أضف ملف عمل أولاً" : undefined}
            >
              <Send className="size-4" />
              نشر للمترجمين
            </Button>
          )}

          {canReview && project.status === "delivered" && (
            <Button
              onClick={() => reviewAction.mutate({ action: "open" })}
              loading={reviewAction.isPending}
            >
              <Eye className="size-4" />
              فتح المراجعة
            </Button>
          )}

          {canReview && project.status === "in_review" && (
            <>
              <Button onClick={() => setApproving(true)}>
                <BadgeCheck className="size-4" />
                اعتماد وإنهاء
              </Button>
              <Button variant="outline" onClick={() => setRequestingRevision(true)}>
                <RotateCcw className="size-4" />
                طلب تعديل
              </Button>
            </>
          )}

          {canManage && project.status === "claimed" && (
            <Button
              variant="outline"
              onClick={async () => {
                const reason = await prompt({
                  title: "سحب الملف من المترجم",
                  description:
                    "يُسحب الملف فوراً ويعود متاحاً لباقي المترجمين — يُسجل السبب في السجل.",
                  label: "سبب السحب",
                  placeholder: "مثال: المترجم في إجازة مرضية…",
                  confirmLabel: "سحب الملف",
                  destructive: true,
                });
                if (reason) withdrawMutation.mutate(reason);
              }}
            >
              <Undo2 className="size-4" />
              سحب الملف
            </Button>
          )}

          {project.status === "completed" && (
            <Button
              onClick={() =>
                // The merge names the final file after the source the client sent,
                // so take the name from the record rather than rebuilding it here.
                download(
                  `/projects/${project.id}/final-file`,
                  finalFiles[0]?.original_name ?? `${project.code}-final.pdf`,
                ).catch(() => toast.error("تعذر تحميل الملف"))
              }
            >
              <FileCheck2 className="size-4" />
              تحميل الملف النهائي
            </Button>
          )}

          {canManage && project.status === "completed" && (
            <Button
              variant="outline"
              onClick={async () => {
                if (
                  await confirm({
                    title: "أرشفة المشروع؟",
                    description:
                      "يُنقل المشروع إلى الأرشيف بعد استلام العميل — تبقى الملفات والسجل متاحة للاطلاع.",
                    confirmLabel: "أرشفة",
                  })
                )
                  archiveMutation.mutate();
              }}
              loading={archiveMutation.isPending}
            >
              <Archive className="size-4" />
              أرشفة المشروع
            </Button>
          )}

          {canManage && ["draft", "available"].includes(project.status) && (
            <Button
              variant="destructive"
              onClick={async () => {
                const reason = await prompt({
                  title: "إلغاء المشروع",
                  description: "سيتم إيقاف المشروع نهائياً ويُسجل السبب في سجل الحالات.",
                  label: "سبب الإلغاء",
                  placeholder: "مثال: ألغى العميل الطلب…",
                  confirmLabel: "إلغاء المشروع",
                  destructive: true,
                });
                if (reason) cancelMutation.mutate(reason);
              }}
            >
              <XCircle className="size-4" />
              إلغاء المشروع
            </Button>
          )}
        </div>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-7">
        <InfoTile label="العميل" value={project.client?.name ?? "—"} />
        <InfoTile
          label="اللغات"
          value={`${project.source_language?.name_ar} ← ${project.target_language?.name_ar}`}
        />
        <InfoTile
          label="الأولوية"
          value={
            <ToneBadge tone={PRIORITY_TONES[project.priority]}>
              {PRIORITY_LABELS[project.priority]}
            </ToneBadge>
          }
        />
        <InfoTile
          label="موعد التسليم"
          value={
            <span className={project.is_late ? "font-semibold text-destructive" : undefined}>
              {dateFormatter.format(new Date(project.deadline_at))}
            </span>
          }
        />
        <InfoTile label="الكلمات" value={project.total_words?.toLocaleString("ar-EG") ?? "—"} />
        <InfoTile label="الصفحات" value={project.total_pages?.toLocaleString("ar-EG") ?? "—"} />
        <InfoTile
          label="الأحرف"
          value={project.total_chars?.toLocaleString("ar-EG") ?? "—"}
        />
      </div>

      {project.instructions && (
        <Card className="border-amber-500/30 bg-amber-500/5 py-4">
          <CardContent className="text-sm">
            <p className="mb-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
              تعليمات خاصة
            </p>
            {project.instructions}
          </CardContent>
        </Card>
      )}

      {project.cancel_reason && (
        <Card className="border-destructive/30 bg-destructive/5 py-4">
          <CardContent className="text-sm">
            <p className="mb-1 text-xs font-semibold text-destructive">سبب الإلغاء</p>
            {project.cancel_reason}
          </CardContent>
        </Card>
      )}

      {/* M9b — the merge failed: the project holds at `approved` until someone retries. */}
      {project.status === "approved" && project.merge_error && (
        <Card className="border-destructive/30 bg-destructive/5 py-4">
          <CardContent className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-destructive">
                <AlertTriangle className="size-3.5" />
                تعذّر إصدار الملف النهائي
                {project.merge_attempts > 1 && ` — ${project.merge_attempts} محاولات`}
              </p>
              <p dir="ltr" className="truncate text-start text-muted-foreground">
                {project.merge_error}
              </p>
            </div>
            {canReview && (
              <Button
                variant="outline"
                className="shrink-0"
                loading={retryMergeMutation.isPending}
                onClick={() => retryMergeMutation.mutate()}
              >
                <RotateCcw className="size-4" />
                إعادة محاولة الدمج
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {!!finalFiles.length && (
            <FilesCard
              title="الملف النهائي"
              icon={<FileCheck2 className="size-4" />}
              files={finalFiles}
              project={project}
              category="final"
              canUpload={false}
              canDelete={false}
              onChanged={invalidate}
              onManualCount={setCountFile}
            />
          )}
          {!!deliverableFiles.length && (
            <FilesCard
              title="تسليمات المترجم"
              icon={<Send className="size-4" />}
              files={deliverableFiles}
              project={project}
              category="deliverable"
              canUpload={false}
              canDelete={false}
              onChanged={invalidate}
              onManualCount={setCountFile}
            />
          )}
          <FilesCard
            title="ملفات العمل"
            icon={<FileText className="size-4" />}
            files={sourceFiles}
            project={project}
            category="source"
            canUpload={canManage && project.status === "draft"}
            canDelete={canManage && project.status === "draft"}
            onChanged={invalidate}
            onManualCount={setCountFile}
          />
          <FilesCard
            title="مستندات داعمة"
            icon={<Paperclip className="size-4" />}
            files={referenceFiles}
            project={project}
            category="reference"
            canUpload={
              canManage && !["completed", "archived", "cancelled"].includes(project.status)
            }
            canDelete={canManage && project.status === "draft"}
            onChanged={invalidate}
            onManualCount={setCountFile}
          />
        </div>

        <div className="space-y-6 self-start">
        {assignment && (
          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-4!">
              <CardTitle className="flex items-center gap-2 text-sm">
                <UserRound className="size-4" />
                المترجم المكلّف
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">الاسم</span>
                <span className="font-medium">{assignment.translator?.name}</span>
              </div>
              {assignment.claimed_at && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">الاستلام</span>
                  <span className="text-xs">
                    {dateFormatter.format(new Date(assignment.claimed_at))}
                  </span>
                </div>
              )}
              {assignment.delivered_at && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">التسليم</span>
                  <span className="text-xs">
                    {dateFormatter.format(new Date(assignment.delivered_at))}
                  </span>
                </div>
              )}
              {assignment.work_seconds != null && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">مدة العمل</span>
                  <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-primary">
                    <Timer className="size-3.5" />
                    {formatDuration(assignment.work_seconds)}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {(project.letterhead || project.stamp) && (
          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-4!">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Stamp className="size-4" />
                الترويسة والختم المعتمدان
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 p-4">
              {[project.letterhead, project.stamp]
                .filter((template) => !!template)
                .map((template) => (
                  <div key={template.id} className="space-y-1.5">
                    <div
                      className={cn(
                        "flex h-24 items-center justify-center overflow-hidden rounded-lg border p-2",
                        template.kind === "stamp"
                          ? "bg-[repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] bg-[length:12px_12px]"
                          : "bg-muted/50",
                      )}
                    >
                      <TemplateAsset template={template} />
                    </div>
                    <p className="truncate text-xs font-medium">{template.name}</p>
                    <p className="text-[11px] text-muted-foreground">{template.kind_label}</p>
                  </div>
                ))}
            </CardContent>
          </Card>
        )}

        {/* Timeline */}
        <Card className="self-start">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <History className="size-4" />
              سجل الحالات
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!timeline?.length && (
              <p className="py-4 text-center text-xs text-muted-foreground">
                لا توجد تحولات بعد — المشروع مسودة
              </p>
            )}
            <ol className="space-y-4">
              {timeline?.map((t) => (
                <li key={t.id} className="relative border-s-2 border-primary/20 ps-4">
                  <span className="absolute -start-[5px] top-1 size-2 rounded-full bg-primary" />
                  <ToneBadge tone={STATUS_TONES[t.to_status]}>{t.to_label}</ToneBadge>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t.actor?.name ?? "النظام"} · {dateFormatter.format(new Date(t.created_at))}
                  </p>
                  {t.note && (
                    <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                      «{t.note}»
                    </p>
                  )}
                  {/* Revision screenshots stay with the round they were sent in. */}
                  {!!t.attachments?.length && (
                    <ul className="mt-1.5 space-y-1">
                      {t.attachments.map((file) => (
                        <li key={file.id} className="flex items-center gap-1.5">
                          <Paperclip className="size-3 shrink-0 text-muted-foreground/60" />
                          <button
                            type="button"
                            dir="ltr"
                            onClick={() =>
                              download(
                                `/projects/${project.id}/files/${file.id}/download`,
                                file.original_name,
                              ).catch(() => toast.error("تعذر تحميل المرفق"))
                            }
                            className="truncate text-start text-[11px] text-primary hover:underline"
                          >
                            {file.original_name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        </div>
      </div>

      <ManualCountDialog
        key={countFile?.id ?? "closed"}
        file={countFile}
        projectId={project.id}
        onClose={() => setCountFile(null)}
        onSaved={invalidate}
      />

      <ApproveDialog
        key={approving ? "approve-open" : "approve-closed"}
        open={approving}
        projectId={project.id}
        onClose={() => setApproving(false)}
        onApproved={invalidate}
      />

      <RevisionRequestDialog

        open={requestingRevision}

        projectId={project.id}

        onClose={() => setRequestingRevision(false)}

        onRequested={invalidate}

      />
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-3 shadow-xs">
      <p className="mb-1 text-[11px] text-muted-foreground">{label}</p>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

function FilesCard({
  title,
  icon,
  files,
  project,
  category,
  canUpload,
  canDelete,
  onChanged,
  onManualCount,
}: {
  title: string;
  icon: React.ReactNode;
  files: ProjectFile[];
  project: Project;
  category: ProjectFile["category"];
  canUpload: boolean;
  canDelete: boolean;
  onChanged: () => void;
  onManualCount: (file: ProjectFile) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { confirm } = useConfirm();
  const { download, upload } = useFileTransfer();
  const [uploading, setUploading] = useState(false);

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("category", category);

    try {
      await upload(`/projects/${project.id}/files`, formData, file.name);
      toast.success("تم رفع الملف" + (category === "source" ? " — جارِ عد الكلمات…" : ""));
      onChanged();
    } catch (err) {
      // Cancelling is the user's own doing — the panel already says so, and a
      // red toast on top of it would read as a failure.
      if (!isAbort(err)) {
        toast.error(err instanceof ApiError ? err.message : "فشل رفع الملف");
      }
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function deleteFile(file: ProjectFile) {
    if (
      !(await confirm({
        title: `حذف الملف «${file.original_name}»؟`,
        confirmLabel: "حذف",
        destructive: true,
      }))
    )
      return;
    try {
      await api(`/projects/${project.id}/files/${file.id}`, { method: "DELETE" });
      toast.success("تم حذف الملف");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ");
    }
  }

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex-row items-center justify-between border-b py-4!">
        <CardTitle className="flex items-center gap-2 text-sm">
          {icon}
          {title}
          <span className="text-xs font-normal text-muted-foreground">({files.length})</span>
        </CardTitle>
        {canUpload && (
          <>
            <input ref={inputRef} type="file" hidden onChange={handleUpload} />
            <Button
              size="sm"
              variant="outline"
              loading={uploading}
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="size-3.5" />
              رفع ملف
            </Button>
          </>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {files.length === 0 && (
          <p className="py-8 text-center text-xs text-muted-foreground">لا توجد ملفات</p>
        )}
        <ul className="divide-y">
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-3 px-5 py-3">
              <FileText className="size-4 shrink-0 text-muted-foreground/50" />
              <div className="min-w-0 flex-1">
                <p dir="ltr" className="truncate text-start text-sm font-medium">
                  {file.original_name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(file.size_bytes)}
                  {/* Deliverables are counted too: when the source is a scan, the
                      translator's file is the only countable document in the project. */}
                  {COUNTED_CATEGORIES.includes(category) && (
                    <>
                      {" · "}
                      {file.count_status === "done"
                        ? `${file.count_source === "ocr" ? "≈ " : ""}${file.word_count?.toLocaleString("ar-EG") ?? "—"} كلمة${
                            file.char_count
                              ? ` · ${file.char_count.toLocaleString("ar-EG")} حرف`
                              : ""
                          }${
                            file.page_count
                              ? ` · ${file.page_count.toLocaleString("ar-EG")} صفحة`
                              : ""
                          }${
                            file.count_source === "manual"
                              ? " (يدوي)"
                              : file.count_source === "ocr"
                                ? " (تقدير OCR)"
                                : ""
                          }`
                        : COUNT_STATUS_LABELS[file.count_status]}
                    </>
                  )}
                </p>
              </div>
              {COUNTED_CATEGORIES.includes(category) &&
                ["not_applicable", "failed", "done"].includes(file.count_status) && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="عد يدوي"
                    onClick={() => onManualCount(file)}
                  >
                    <Calculator className="size-4" />
                  </Button>
                )}
              <Button
                variant="ghost"
                size="icon-sm"
                title="تحميل"
                onClick={() =>
                  download(
                    `/projects/${project.id}/files/${file.id}/download`,
                    file.original_name,
                  ).catch(() => toast.error("تعذر تحميل الملف"))
                }
              >
                <Download className="size-4" />
              </Button>
              {canDelete && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="حذف"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => deleteFile(file)}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ManualCountDialog({
  file,
  projectId,
  onClose,
  onSaved,
}: {
  file: ProjectFile | null;
  projectId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [words, setWords] = useState(() => file?.word_count?.toString() ?? "");
  const [chars, setChars] = useState(() => file?.char_count?.toString() ?? "");
  const [pages, setPages] = useState(() => file?.page_count?.toString() ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await api(`/projects/${projectId}/files/${file!.id}/manual-count`, {
        method: "PUT",
        json: {
          word_count: words ? Number(words) : null,
          page_count: pages ? Number(pages) : null,
          char_count: chars ? Number(chars) : null,
        },
      });
      toast.success("تم حفظ العد اليدوي");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={!!file} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>عد يدوي للكلمات والأحرف والصفحات</DialogTitle>
          <DialogDescription>
            للمستندات الممسوحة ضوئياً التي يتعذر عدها تلقائياً (استخراج النصوص OCR ضمن المرحلة
            الثانية).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <Field label="عدد الكلمات" htmlFor="mc-words">
              <Input
                id="mc-words"
                type="number"
                min={0}
                dir="ltr"
                value={words}
                onChange={(e) => setWords(e.target.value)}
              />
            </Field>
            <Field label="عدد الأحرف" htmlFor="mc-chars">
              <Input
                id="mc-chars"
                type="number"
                min={0}
                dir="ltr"
                value={chars}
                onChange={(e) => setChars(e.target.value)}
              />
            </Field>
            <Field label="عدد الصفحات" htmlFor="mc-pages">
              <Input
                id="mc-pages"
                type="number"
                min={0}
                dir="ltr"
                value={pages}
                onChange={(e) => setPages(e.target.value)}
              />
            </Field>
          </div>
          {/* The office bills on this figure, so say plainly which one it is. */}
          <p className="text-xs text-muted-foreground">
            الأحرف تُحسب دون المسافات والتشكيل والتطويل.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              إلغاء
            </Button>
            <Button type="submit" loading={submitting}>
              حفظ العد
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
