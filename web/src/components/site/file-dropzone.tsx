"use client";

import { useRef, useState } from "react";
import { FileText, Paperclip, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** What the API accepts — served by /public/quote-requests/limits so the two can't drift. */
export interface UploadLimits {
  max_files: number;
  max_file_kb: number;
  extensions: string[];
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} م.ب`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} ك.ب`;
  return `${bytes} بايت`;
}

/**
 * The documents-to-translate picker of the website's forms: drag or pick, see the
 * list, take one back. Shared by the public quote form and the client's own
 * new-project form, which take the same files under the same rules.
 */
export function FileDropzone({
  files,
  onChange,
  limits,
  error,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  limits?: UploadLimits;
  error?: string;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const maxFiles = limits?.max_files ?? 10;
  const maxFileBytes = (limits?.max_file_kb ?? 25600) * 1024;

  /** Reject what the API would reject anyway, but before the upload wastes their time. */
  function addFiles(incoming: FileList | null) {
    if (!incoming) return;

    const accepted: File[] = [];
    for (const file of Array.from(incoming)) {
      if (file.size > maxFileBytes) {
        toast.error(`«${file.name}» أكبر من الحد المسموح (${formatBytes(maxFileBytes)})`);
        continue;
      }
      if (files.length + accepted.length >= maxFiles) {
        toast.error(`الحد الأقصى ${maxFiles} ملفات لكل طلب`);
        break;
      }
      accepted.push(file);
    }

    if (accepted.length) onChange([...files, ...accepted]);
  }

  return (
    <>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          addFiles(event.dataTransfer.files);
        }}
        className={cn(
          "rounded-xl border-2 border-dashed p-8 text-center transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-border bg-muted/30",
        )}
      >
        <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Upload className="size-5" />
        </span>
        <p className="mt-3 text-sm font-medium">اسحب الملفات إلى هنا</p>
        <p className="mt-1 text-xs text-muted-foreground">
          الصيغ المدعومة:{" "}
          {/* Latin extension list — forced LTR so the ellipsis doesn't jump to the front. */}
          <span dir="ltr" className="inline-block">
            {(limits?.extensions ?? ["pdf", "docx", "xlsx", "jpg", "png"]).slice(0, 8).join(", ")}
            {(limits?.extensions?.length ?? 0) > 8 ? "…" : ""}
          </span>
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => fileInput.current?.click()}
        >
          <Paperclip className="size-4" />
          اختر من جهازك
        </Button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {files.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-xl border">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex items-center gap-3 bg-card px-4 py-2.5">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-[13px]">{file.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(file.size)}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`حذف ${file.name}`}
                onClick={() => onChange(files.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
