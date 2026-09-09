"use client";

import { useRef, useState } from "react";
import { CheckCircle2, Download, History, IdCard, RotateCcw, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { isAbort, useFileTransfer } from "@/lib/use-transfer";
import type { DocumentRequest, Project, ProjectFile } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ToneBadge } from "@/components/tone-badge";
import { useConfirm } from "@/components/confirm";

const dateFormatter = new Intl.DateTimeFormat("ar-EG", {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * The office's side of "this certificate needs an ID attached".
 *
 * Shows what has been asked for and what came back. The upload button here is not
 * a duplicate of the client's: most scans still arrive on WhatsApp, and the PM
 * closing the request themselves has to leave exactly the same trail — same row,
 * same link to the file — or the client's own area would still be nagging them
 * for a document the office already has.
 */
export function DocumentRequestsCard({
  project,
  canManage,
  onAsk,
  onChanged,
}: {
  project: Project;
  canManage: boolean;
  /** Opens the page's one request dialog — the file rows share it. */
  onAsk: () => void;
  onChanged: () => void;
}) {
  const { confirm } = useConfirm();

  const requests = project.document_requests ?? [];
  const settled = ["completed", "archived", "cancelled"].includes(project.status);
  const open = requests.filter((request) => request.status === "pending");

  // Nothing asked and nothing to ask with: an empty card here would be noise on
  // every project that never needed a supporting document, which is most of them.
  if (requests.length === 0 && (!canManage || settled)) return null;

  async function cancelRequest(request: DocumentRequest) {
    if (
      !(await confirm({
        title: `إلغاء طلب «${request.kind_label}»؟`,
        description: "لن يظهر الطلب للعميل بعد الإلغاء.",
        confirmLabel: "إلغاء الطلب",
        destructive: true,
      }))
    )
      return;

    try {
      await api(`/projects/${project.id}/document-requests/${request.id}`, { method: "DELETE" });
      toast.success("أُلغي الطلب");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ");
    }
  }

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex-row items-center justify-between border-b py-4!">
        <CardTitle className="flex items-center gap-2 text-sm">
          <IdCard className="size-4" />
          مستندات مطلوبة من العميل
          {open.length > 0 && (
            <ToneBadge tone="amber">{open.length.toLocaleString("ar-EG")} قيد الانتظار</ToneBadge>
          )}
        </CardTitle>
        {canManage && !settled && (
          <Button size="sm" variant="outline" onClick={onAsk}>
            <IdCard className="size-3.5" />
            طلب مستند
          </Button>
        )}
      </CardHeader>

      <CardContent className="p-0">
        {requests.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            لم يُطلب أي مستند من العميل على هذا المشروع
          </p>
        ) : (
          <ul className="divide-y">
            {requests.map((request) => (
              <RequestRow
                key={request.id}
                request={request}
                project={project}
                canManage={canManage && !settled}
                onChanged={onChanged}
                onCancel={() => cancelRequest(request)}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RequestRow({
  request,
  project,
  canManage,
  onChanged,
  onCancel,
}: {
  request: DocumentRequest;
  project: Project;
  canManage: boolean;
  onChanged: () => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { upload, download } = useFileTransfer();
  const { confirm, prompt } = useConfirm();
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  // Fulfilled requests keep their files on the row; the ones already on the
  // project's own list would otherwise say nothing about what they answered.
  const attachments: ProjectFile[] =
    request.attachments ??
    (project.files ?? []).filter((file) => file.document_request_id === request.id);

  // Rejected rounds stay on the record but are visibly out of play — and the
  // translator never sees them at all.
  const current = attachments.filter((file) => !file.superseded_at);
  const superseded = attachments.filter((file) => file.superseded_at);

  /** The wrong document arrived: supersede it and put the ask back to the client. */
  async function askAgain() {
    const note = await prompt({
      title: "طلب نسخة أخرى من المستند",
      description:
        "يُحفظ الملف الحالي في السجل ويخرج من قائمة ملفات المترجم، ويعود الطلب إلى «بانتظار العميل».",
      label: "سبب الرفض (يصل للعميل)",
      placeholder: "مثال: الصورة غير واضحة، من فضلك أعد التصوير في إضاءة أفضل.",
      confirmLabel: "أرسل الطلب",
    });

    if (!note) return;

    setBusy(true);
    try {
      await api(`/projects/${project.id}/document-requests/${request.id}/reopen`, {
        method: "POST",
        json: { note },
      });
      toast.success("أُرسل الطلب — بانتظار نسخة جديدة من العميل");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ");
    } finally {
      setBusy(false);
    }
  }

  async function deleteAttachment(file: ProjectFile) {
    if (
      !(await confirm({
        title: `حذف «${file.original_name}»؟`,
        description: "يُحذف الملف نهائياً. إن كان آخر ملف على الطلب فسيعود الطلب مفتوحاً.",
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

  async function uploadOnBehalf(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    if (picked.length === 0) return;
    setUploading(true);

    const form = new FormData();
    picked.forEach((file) => form.append("files[]", file));
    form.append("category", "reference");
    form.append("document_request_id", String(request.id));

    try {
      await upload(
        `/projects/${project.id}/files`,
        form,
        picked.length === 1 ? picked[0].name : `${picked.length.toLocaleString("ar-EG")} ملفات`,
      );
      toast.success("تم رفع المستند وإغلاق الطلب");
      onChanged();
    } catch (err) {
      if (!isAbort(err)) toast.error(err instanceof ApiError ? err.message : "فشل رفع الملف");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <li className="space-y-2 px-5 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            {request.kind_label}
            {request.status === "pending" && <ToneBadge tone="amber">بانتظار العميل</ToneBadge>}
            {request.status === "fulfilled" && (
              <ToneBadge tone="green">
                <CheckCircle2 />
                وصل
              </ToneBadge>
            )}
            {request.status === "cancelled" && <ToneBadge tone="slate">ملغي</ToneBadge>}
          </p>
          {request.file_name && (
            <p dir="ltr" className="mt-0.5 truncate text-start text-xs text-muted-foreground">
              {request.file_name}
            </p>
          )}
          {!request.file_name && (
            <p className="mt-0.5 text-xs text-muted-foreground">المشروع ككل</p>
          )}
          {request.note && <p className="mt-1 text-xs text-muted-foreground">{request.note}</p>}
          <p className="mt-1 text-[11px] text-muted-foreground/80">
            طُلب {dateFormatter.format(new Date(request.created_at))}
          </p>
        </div>

        {request.status === "fulfilled" && canManage && (
          <Button size="sm" variant="outline" loading={busy} onClick={askAgain}>
            <RotateCcw className="size-3.5" />
            طلب نسخة أخرى
          </Button>
        )}

        {request.status === "pending" && canManage && (
          <div className="flex shrink-0 items-center gap-1">
            <input
              ref={inputRef}
              type="file"
              hidden
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.webp,image/*,application/pdf"
              onChange={uploadOnBehalf}
            />
            <Button
              size="sm"
              variant="outline"
              loading={uploading}
              title="إن وصل المستند بالبريد أو واتساب"
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="size-3.5" />
              رفع نيابة عن العميل
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="إلغاء الطلب"
              className="text-muted-foreground hover:text-destructive"
              onClick={onCancel}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        )}
      </div>

      {current.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-muted/40 p-2">
          {current.map((file) => (
            <AttachmentRow
              key={file.id}
              file={file}
              projectId={project.id}
              canDelete={canManage}
              onDownload={() =>
                download(
                  `/projects/${project.id}/files/${file.id}/download`,
                  file.original_name,
                ).catch(() => toast.error("تعذر تحميل الملف"))
              }
              onDelete={() => deleteAttachment(file)}
            />
          ))}
        </ul>
      )}

      {superseded.length > 0 && (
        <div className="rounded-lg border border-dashed p-2">
          <p className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <History className="size-3" />
            نسخ سابقة مرفوضة ({superseded.length.toLocaleString("ar-EG")}) — لا تظهر للمترجم
          </p>
          <ul className="space-y-1 opacity-60">
            {superseded.map((file) => (
              <AttachmentRow
                key={file.id}
                file={file}
                projectId={project.id}
                canDelete={canManage}
                onDownload={() =>
                  download(
                    `/projects/${project.id}/files/${file.id}/download`,
                    file.original_name,
                  ).catch(() => toast.error("تعذر تحميل الملف"))
                }
                onDelete={() => deleteAttachment(file)}
              />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

function AttachmentRow({
  file,
  canDelete,
  onDownload,
  onDelete,
}: {
  file: ProjectFile;
  projectId: number;
  canDelete: boolean;
  onDownload: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <p dir="ltr" className="truncate text-start text-xs font-medium">
          {file.original_name}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {formatBytes(file.size_bytes)}
          {file.uploaded_by_client ? " · رفعه العميل" : ""}
        </p>
      </div>
      <Button variant="ghost" size="icon-sm" title="تحميل" onClick={onDownload}>
        <Download className="size-4" />
      </Button>
      {canDelete && (
        <Button
          variant="ghost"
          size="icon-sm"
          title="حذف نهائي"
          className="text-muted-foreground hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="size-4" />
        </Button>
      )}
    </li>
  );
}
