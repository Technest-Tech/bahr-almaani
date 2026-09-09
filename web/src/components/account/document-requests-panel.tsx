"use client";

import { useRef, useState } from "react";
import { CheckCircle2, Download, History, IdCard, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { ApiError, downloadFile } from "@/lib/api";
import { clientApi } from "@/lib/client-auth";
import { isAbort, useFileTransfer } from "@/lib/use-transfer";
import type { ClientProject, DocumentRequest } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useConfirm } from "@/components/confirm";

/** Kept in step with ClientPortalController::MAX_CLIENT_FILES / MAX_CLIENT_FILE_KB. */
const MAX_FILES = 6;
const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.heic,image/*,application/pdf";

const dateFormatter = new Intl.DateTimeFormat("ar-EG", { dateStyle: "long" });

/**
 * "We need a document from you" — the client's side of the loop.
 *
 * Deliberately loud and at the top of the project page: this is the one thing on
 * the whole screen that is blocking their translation, and the office's previous
 * answer to it was a WhatsApp message that got buried. Only open requests take an
 * upload; answered ones stay listed so the client can see what they already sent.
 */
export function DocumentRequestsPanel({
  project,
  onUploaded,
}: {
  project: ClientProject;
  onUploaded: () => void;
}) {
  // Cancelled asks are the office changing its mind; showing them would only
  // make the client wonder what they missed.
  const requests = (project.document_requests ?? []).filter(
    (request) => request.status !== "cancelled",
  );

  if (requests.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <IdCard className="size-4" />
        مستندات مطلوبة منك
      </h2>
      {requests.map((request) => (
        <RequestCard
          key={request.id}
          request={request}
          projectId={project.id}
          onUploaded={onUploaded}
        />
      ))}
    </section>
  );
}

function RequestCard({
  request,
  projectId,
  onUploaded,
}: {
  request: DocumentRequest;
  projectId: number;
  onUploaded: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { upload } = useFileTransfer();
  const { confirm } = useConfirm();
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  const pending = request.status === "pending";

  // What the office rejected stays visible so the client can see *which* file was
  // turned down, but it is out of play and not theirs to remove any more.
  const attachments = request.attachments ?? [];
  const current = attachments.filter((file) => !file.superseded_at);
  const superseded = attachments.filter((file) => file.superseded_at);

  /**
   * "I uploaded the wrong photo."
   *
   * Removing the last file reopens the request server-side, which is what brings
   * the upload button back — so the client fixes their own mistake without having
   * to ask the office to ask again.
   */
  async function removeOne(fileId: number, name: string) {
    if (
      !(await confirm({
        title: `حذف «${name}»؟`,
        description: "سيمكنك رفع نسخة أخرى بدلاً منه.",
        confirmLabel: "حذف",
        destructive: true,
      }))
    )
      return;

    setDeleting(fileId);
    try {
      await clientApi(`/client/projects/${projectId}/files/${fileId}`, { method: "DELETE" });
      toast.success("تم حذف الملف — يمكنك رفع نسخة أخرى");
      onUploaded();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذر حذف الملف");
    } finally {
      setDeleting(null);
    }
  }

  // The client's own copy of what they sent — the same bytes, through their scope.
  async function downloadOne(fileId: number, name: string) {
    setDownloading(fileId);
    try {
      await downloadFile(`/client/projects/${projectId}/files/${fileId}/download`, name, {
        realm: "client",
      });
    } catch {
      toast.error("تعذر تحميل الملف. حاول مرة أخرى.");
    } finally {
      setDownloading(null);
    }
  }

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    if (inputRef.current) inputRef.current.value = "";
    if (picked.length === 0) return;

    if (picked.length > MAX_FILES) {
      toast.error(`الحد الأقصى ${MAX_FILES.toLocaleString("ar-EG")} ملفات`);
      return;
    }

    // Checked here as well as on the server: a 20 MB photo on a slow line should
    // fail before it is uploaded, not after.
    const tooBig = picked.find((file) => file.size > MAX_BYTES);
    if (tooBig) {
      toast.error(`«${tooBig.name}» أكبر من ٢٠ ميجابايت`);
      return;
    }

    setUploading(true);

    const form = new FormData();
    picked.forEach((file) => form.append("files[]", file));
    form.append("document_request_id", String(request.id));

    try {
      await upload(
        `/client/projects/${projectId}/files`,
        form,
        picked.length === 1 ? picked[0].name : `${picked.length.toLocaleString("ar-EG")} ملفات`,
        { realm: "client" },
      );
      toast.success("تم إرسال المستند — شكراً لك");
      onUploaded();
    } catch (err) {
      if (!isAbort(err)) toast.error(err instanceof ApiError ? err.message : "فشل رفع الملف");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card className={pending ? "border-amber-300 bg-amber-50/50 dark:bg-amber-500/5" : undefined}>
      <CardContent className="flex flex-wrap items-start justify-between gap-4 px-5">
        <div className="min-w-0 space-y-1">
          <p className="flex items-center gap-2 text-sm font-semibold">
            {request.kind_label}
            {pending && superseded.length > 0 && (
              <span className="text-xs font-normal text-amber-700 dark:text-amber-400">
                — مطلوب نسخة أخرى
              </span>
            )}
            {!pending && (
              <span className="inline-flex items-center gap-1 text-xs font-normal text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-3.5" />
                وصلنا
              </span>
            )}
          </p>
          {request.file_name && (
            <p className="text-xs text-muted-foreground">
              خاص بملف: <span dir="ltr">{request.file_name}</span>
            </p>
          )}
          {request.note && <p className="text-[13px] leading-relaxed">{request.note}</p>}
          <p className="text-[11.5px] text-muted-foreground/80">
            {pending
              ? `طُلب في ${dateFormatter.format(new Date(request.created_at))}`
              : request.fulfilled_at
                ? `أُرسل في ${dateFormatter.format(new Date(request.fulfilled_at))}`
                : null}
          </p>
          {current.length > 0 && (
            <ul className="space-y-0.5 pt-1">
              {current.map((file) => (
                <li key={file.id} className="flex items-center gap-1">
                  <span dir="ltr" className="truncate text-start text-[11.5px] text-muted-foreground">
                    {file.original_name}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="تحميل"
                    loading={downloading === file.id}
                    onClick={() => downloadOne(file.id, file.original_name)}
                  >
                    <Download className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="حذف ورفع نسخة أخرى"
                    className="text-muted-foreground hover:text-destructive"
                    loading={deleting === file.id}
                    onClick={() => removeOne(file.id, file.original_name)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {superseded.length > 0 && (
            <p className="flex items-center gap-1.5 pt-1 text-[11.5px] text-muted-foreground/80">
              <History className="size-3" />
              نسخة سابقة لم تُقبل:{" "}
              <span dir="ltr" className="truncate">
                {superseded.map((file) => file.original_name).join("، ")}
              </span>
            </p>
          )}
        </div>

        {pending && (
          <>
            <input
              ref={inputRef}
              type="file"
              hidden
              multiple
              accept={ACCEPT}
              onChange={handleUpload}
            />
            <Button loading={uploading} onClick={() => inputRef.current?.click()}>
              <Upload className="size-4" />
              رفع المستند
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
