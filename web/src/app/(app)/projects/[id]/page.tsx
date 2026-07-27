"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Calculator,
  Download,
  FileText,
  History,
  Paperclip,
  Send,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, downloadFile, getToken } from "@/lib/api";
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
import { useAuth } from "@/lib/auth";

const dateFormatter = new Intl.DateTimeFormat("ar-EG", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} م.ب`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} ك.ب`;
  return `${bytes} بايت`;
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const { prompt } = useConfirm();
  const queryClient = useQueryClient();
  const [countFile, setCountFile] = useState<ProjectFile | null>(null);

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

  if (isLoading || !project) {
    return (
      <div className="w-full space-y-6">
        <Skeleton className="h-5 w-40" />
        <div className="space-y-2">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const canManage = can("projects.manage");
  const sourceFiles = project.files?.filter((f) => f.category === "source") ?? [];
  const referenceFiles = project.files?.filter((f) => f.category === "reference") ?? [];

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

        {canManage && (
          <div className="flex gap-2">
            {project.status === "draft" && (
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
            {["draft", "available"].includes(project.status) && (
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
        )}
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
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
                  {t.note && <p className="mt-1 text-xs text-muted-foreground">«{t.note}»</p>}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      <ManualCountDialog
        key={countFile?.id ?? "closed"}
        file={countFile}
        projectId={project.id}
        onClose={() => setCountFile(null)}
        onSaved={invalidate}
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
  category: "source" | "reference";
  canUpload: boolean;
  canDelete: boolean;
  onChanged: () => void;
  onManualCount: (file: ProjectFile) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { confirm } = useConfirm();
  const [uploading, setUploading] = useState(false);

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("category", category);

    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
      const response = await fetch(`${API_URL}/projects/${project.id}/files`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: formData,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new ApiError(response.status, body.message ?? "فشل رفع الملف");
      }
      toast.success("تم رفع الملف" + (category === "source" ? " — جارِ عد الكلمات…" : ""));
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل رفع الملف");
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
                  {category === "source" && (
                    <>
                      {" · "}
                      {file.count_status === "done"
                        ? `${file.word_count?.toLocaleString("ar-EG") ?? "—"} كلمة${
                            file.page_count
                              ? ` · ${file.page_count.toLocaleString("ar-EG")} صفحة`
                              : ""
                          }${file.count_source === "manual" ? " (يدوي)" : ""}`
                        : COUNT_STATUS_LABELS[file.count_status]}
                    </>
                  )}
                </p>
              </div>
              {category === "source" &&
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
                  downloadFile(
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
          <DialogTitle>عد يدوي للكلمات والصفحات</DialogTitle>
          <DialogDescription>
            للمستندات الممسوحة ضوئياً التي يتعذر عدها تلقائياً (استخراج النصوص OCR ضمن المرحلة
            الثانية).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
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
