"use client";

import { useRef, useState } from "react";
import { Download, FolderUp, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { ApiError, downloadFile } from "@/lib/api";
import { clientApi } from "@/lib/client-auth";
import { isAbort, useFileTransfer } from "@/lib/use-transfer";
import type { ClientProject } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm";
import { officeFormat } from "@/lib/format";

/** Kept in step with ClientPortalController::MAX_CLIENT_FILES / MAX_CLIENT_FILE_KB. */
const MAX_FILES = 6;
const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.heic,image/*,application/pdf";

const dateFormatter = officeFormat({ dateStyle: "medium" });

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} كيلوبايت`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} ميجابايت`;
}

/**
 * Files the client sends to their project without being asked.
 *
 * The office used to accept a client's file only as the answer to its own request,
 * so a client with a second document had nowhere to put it. This is the open door:
 * as many uploads as they need until the project is finished. What arrives is
 * supporting material for the office — it does not change the quote or the count.
 * Answers to the office's requests stay in their own cards above.
 */
export function ClientUploadsPanel({
  project,
  onChanged,
}: {
  project: ClientProject;
  onChanged: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { upload } = useFileTransfer();
  const { confirm } = useConfirm();
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  // Theirs, and not the answer to a request — those are listed under the request.
  // Nor a work file they added to their own new project: those sit with the sources.
  const sent = (project.files ?? []).filter(
    (file) =>
      file.uploaded_by_client && !file.document_request_id && file.category === "reference",
  );
  const open = project.stage !== "completed" && project.stage !== "cancelled";

  // A finished project with nothing sent has nothing to show.
  if (!open && sent.length === 0) return null;

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    if (inputRef.current) inputRef.current.value = "";
    if (picked.length === 0) return;

    if (picked.length > MAX_FILES) {
      toast.error(`الحد الأقصى ${MAX_FILES.toLocaleString("ar-EG")} ملفات في المرة الواحدة`);
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

    try {
      await upload(
        `/client/projects/${project.id}/files`,
        form,
        picked.length === 1 ? picked[0].name : `${picked.length.toLocaleString("ar-EG")} ملفات`,
        { realm: "client" },
      );
      toast.success(picked.length === 1 ? "وصل الملف إلى المكتب" : "وصلت الملفات إلى المكتب");
      onChanged();
    } catch (err) {
      if (!isAbort(err)) toast.error(err instanceof ApiError ? err.message : "فشل رفع الملف");
    } finally {
      setUploading(false);
    }
  }

  async function remove(fileId: number, name: string) {
    if (
      !(await confirm({
        title: `حذف «${name}»؟`,
        description: "يُحذف الملف من المشروع ويُبلَّغ المكتب بذلك.",
        confirmLabel: "حذف",
        destructive: true,
      }))
    )
      return;

    setDeleting(fileId);
    try {
      await clientApi(`/client/projects/${project.id}/files/${fileId}`, { method: "DELETE" });
      toast.success("تم حذف الملف");
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذر حذف الملف");
    } finally {
      setDeleting(null);
    }
  }

  async function downloadOne(fileId: number, name: string) {
    setDownloading(fileId);
    try {
      await downloadFile(`/client/projects/${project.id}/files/${fileId}/download`, name, {
        realm: "client",
      });
    } catch {
      toast.error("تعذر تحميل الملف. حاول مرة أخرى.");
    } finally {
      setDownloading(null);
    }
  }

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <FolderUp className="size-4" />
          مستندات أرسلتها
        </h2>
        {open && (
          <>
            <input
              ref={inputRef}
              type="file"
              hidden
              multiple
              accept={ACCEPT}
              onChange={handleUpload}
            />
            <Button size="sm" loading={uploading} onClick={() => inputRef.current?.click()}>
              <Upload className="size-4" />
              رفع ملفات
            </Button>
          </>
        )}
      </div>

      {open && (
        <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
          {/* On their own unpublished project a missing page goes in with the files
              to translate, above — this panel is only what the office needs beside them. */}
          {project.stage === "submitted"
            ? "أرسل ما يحتاجه المكتب بجانب الملفات ولا يُترجم (هوية، مستند داعم)"
            : "أرسل أي مستند يحتاجه المكتب لهذا المشروع (هوية، صفحة إضافية، مستند داعم)"}{" "}
          — صور أو PDF، حتى {MAX_FILES.toLocaleString("ar-EG")} ملفات في المرة و٢٠ ميجابايت للملف.
          يمكنك الرفع أكثر من مرة.
        </p>
      )}

      {sent.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          لم ترسل أي مستندات إضافية بعد.
        </p>
      ) : (
        <ul className="mt-3 divide-y rounded-xl border bg-card">
          {sent.map((file) => (
            <li key={file.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p dir="ltr" className="truncate text-start text-[13.5px] font-medium">
                  {file.original_name}
                </p>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {formatSize(file.size_bytes)} · أُرسل {dateFormatter.format(new Date(file.created_at))}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                loading={downloading === file.id}
                onClick={() => downloadOne(file.id, file.original_name)}
              >
                <Download className="size-4" />
                تحميل
              </Button>
              {open && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="حذف"
                  aria-label={`حذف ${file.original_name}`}
                  className="text-muted-foreground hover:text-destructive"
                  loading={deleting === file.id}
                  onClick={() => remove(file.id, file.original_name)}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
