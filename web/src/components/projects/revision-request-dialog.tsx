"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { isAbort, useFileTransfer } from "@/lib/use-transfer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/field";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  projectId: number | string;
  onClose: () => void;
  onRequested: () => void;
}

/** Kept in step with ReviewController::MAX_ATTACHMENTS / MAX_ATTACHMENT_KB. */
const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = ".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf";

/**
 * Send work back to the translator with a note and, optionally, screenshots.
 *
 * The note used to be a bare text prompt. The office asked to attach images
 * because pointing at a mis-placed seal or a wrong line in a picture is faster and
 * less ambiguous than describing it — so this is a real form, and it posts
 * multipart through the transfer panel so a 10 MB screenshot on a slow line shows
 * a percentage instead of a frozen button.
 */
export function RevisionRequestDialog({ open, projectId, onClose, onRequested }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const { upload } = useFileTransfer();
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derived, not state: creating the URLs in an effect and storing them would set
  // state during render and cascade. The effect only cleans up — leaking these
  // would pin every screenshot the PM previewed in memory for the tab's lifetime.
  const previews = useMemo(() => {
    const urls: Record<string, string> = {};
    for (const file of files) {
      if (file.type.startsWith("image/")) urls[fileKey(file)] = URL.createObjectURL(file);
    }
    return urls;
  }, [files]);

  useEffect(() => () => Object.values(previews).forEach(URL.revokeObjectURL), [previews]);

  function addFiles(incoming: FileList | null) {
    if (!incoming?.length) return;

    const accepted: File[] = [];
    for (const file of Array.from(incoming)) {
      if (file.size > MAX_BYTES) {
        toast.error(`«${file.name}» أكبر من ${formatBytes(MAX_BYTES)}`);
        continue;
      }
      accepted.push(file);
    }

    setFiles((current) => {
      const merged = [...current];
      for (const file of accepted) {
        if (merged.length >= MAX_FILES) {
          toast.error(`الحد الأقصى ${MAX_FILES.toLocaleString("ar-EG")} مرفقات`);
          break;
        }
        if (!merged.some((f) => fileKey(f) === fileKey(file))) merged.push(file);
      }
      return merged;
    });
  }

  function removeFile(key: string) {
    setFiles((current) => current.filter((f) => fileKey(f) !== key));
  }

  function close() {
    setNote("");
    setFiles([]);
    setError(null);
    setSubmitting(false);
    onClose();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    if (!note.trim()) {
      setError("اكتب ملاحظات المراجعة");
      return;
    }

    setSubmitting(true);
    setError(null);

    const form = new FormData();
    form.append("note", note.trim());
    files.forEach((file) => form.append("attachments[]", file));

    try {
      await upload(
        `/projects/${projectId}/review/request-revision`,
        form,
        files.length ? `طلب تعديل (${files.length.toLocaleString("ar-EG")} مرفق)` : "طلب تعديل",
      );
      toast.success("أُعيد الملف للمترجم مع الملاحظات");
      onRequested();
      close();
    } catch (err) {
      if (isAbort(err)) {
        setSubmitting(false);
        return;
      }
      const message = err instanceof ApiError ? err.message : "حدث خطأ";
      setError(message);
      toast.error(message);
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>طلب تعديل</DialogTitle>
          <DialogDescription>
            تُرسل الملاحظات للمترجم ويُعاد قفل الملف حتى تسليم التعديل.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <Field label="ملاحظات المراجعة" htmlFor="rev-note" error={error ?? undefined}>
            <Textarea
              id="rev-note"
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="وضّح المطلوب تعديله…"
              maxLength={2000}
              autoFocus
            />
          </Field>

          <div>
            <p className="mb-1.5 text-sm font-medium">
              مرفقات{" "}
              <span className="text-xs font-normal text-muted-foreground">
                (اختياري — صور أو PDF، حتى {MAX_FILES.toLocaleString("ar-EG")} ملفات)
              </span>
            </p>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                addFiles(e.dataTransfer.files);
              }}
              className={cn(
                "rounded-xl border border-dashed p-4 text-center transition-colors",
                dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25",
              )}
            >
              <input
                ref={fileInput}
                type="file"
                hidden
                multiple
                accept={ACCEPT}
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInput.current?.click()}
                disabled={files.length >= MAX_FILES}
              >
                <ImagePlus className="size-4" />
                إضافة صورة
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                أو أفلت الصور هنا — لقطة الشاشة أوضح من الشرح
              </p>
            </div>

            {files.length > 0 && (
              <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {files.map((file) => {
                  const key = fileKey(file);
                  return (
                    <li key={key} className="group relative overflow-hidden rounded-lg border">
                      {previews[key] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={previews[key]}
                          alt={file.name}
                          className="h-24 w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-24 w-full items-center justify-center bg-muted text-xs text-muted-foreground">
                          PDF
                        </div>
                      )}
                      <p
                        dir="ltr"
                        className="truncate px-2 py-1 text-start text-[11px] text-muted-foreground"
                      >
                        {file.name}
                      </p>
                      <button
                        type="button"
                        title="إزالة"
                        onClick={() => removeFile(key)}
                        className="absolute end-1 top-1 rounded-full bg-background/90 p-1 text-muted-foreground shadow-sm transition-colors hover:text-destructive"
                      >
                        <X className="size-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              إلغاء
            </Button>
            <Button type="submit" loading={submitting}>
              <RotateCcw className="size-4" />
              إرسال للمترجم
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Identity for a picked file — name+size+mtime is enough to spot a re-pick. */
function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}
