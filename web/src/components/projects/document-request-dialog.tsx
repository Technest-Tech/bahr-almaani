"use client";

import { useState } from "react";
import { IdCard } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { DOCUMENT_KIND_LABELS, type DocumentKind, type ProjectFile } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/field";

interface Props {
  open: boolean;
  projectId: number | string;
  /** The work files the ask can be about — a request names one, not the project. */
  sourceFiles: ProjectFile[];
  /** Pre-selected when the PM started from a particular file's row. */
  defaultFileId?: number | null;
  onClose: () => void;
  onRequested: () => void;
}

/** The sentinel for "about the job as a whole" — Select cannot hold an empty value. */
const WHOLE_PROJECT = "none";

/**
 * Ask the client for a document the file cannot be translated without.
 *
 * The file picker is the point of the form. A visa batch is four certificates for
 * four people, and "we need the ID" is unanswerable unless the ask says whose —
 * so the client's upload box appears under the document it belongs to.
 */
export function DocumentRequestDialog({
  open,
  projectId,
  sourceFiles,
  defaultFileId,
  onClose,
  onRequested,
}: Props) {
  const [kind, setKind] = useState<DocumentKind>("identity");
  // Seeded once per mount. The PM reaches this dialog from a particular file's
  // row, so the parent remounts it with a `key` rather than resetting state in an
  // effect — the same pattern as ManualCountDialog and ApproveDialog.
  const [fileId, setFileId] = useState<string>(
    defaultFileId ? String(defaultFileId) : WHOLE_PROJECT,
  );
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setSubmitting(false);
    onClose();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await api(`/projects/${projectId}/document-requests`, {
        method: "POST",
        json: {
          project_file_id: fileId === WHOLE_PROJECT ? null : Number(fileId),
          kind,
          note: note.trim() || null,
        },
      });
      toast.success("أُرسل الطلب للعميل — سيظهر له في حسابه على الموقع");
      onRequested();
      close();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "حدث خطأ";
      setError(message);
      toast.error(message);
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>طلب مستند من العميل</DialogTitle>
          <DialogDescription>
            يظهر الطلب للعميل في صفحة المشروع بحسابه، ويرفع المستند من هناك مباشرة.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <Field label="نوع المستند" htmlFor="dr-kind">
            <Select value={kind} onValueChange={(value) => setKind(value as DocumentKind)}>
              <SelectTrigger id="dr-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="identity">{DOCUMENT_KIND_LABELS.identity}</SelectItem>
                <SelectItem value="supporting">{DOCUMENT_KIND_LABELS.supporting}</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="عن أي ملف؟"
            htmlFor="dr-file"
            hint="اختر الملف المعني حتى يعرف العميل — والمترجم — هوية مَن المطلوبة."
          >
            <Select value={fileId} onValueChange={setFileId}>
              <SelectTrigger id="dr-file" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={WHOLE_PROJECT}>المشروع ككل</SelectItem>
                {sourceFiles.map((file) => (
                  <SelectItem key={file.id} value={String(file.id)}>
                    {file.original_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="ملاحظة للعميل (اختياري)" htmlFor="dr-note" error={error ?? undefined}>
            <Textarea
              id="dr-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="مثال: صورة واضحة من البطاقة بالوجهين لضبط تهجئة الاسم."
              maxLength={1000}
            />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              إلغاء
            </Button>
            <Button type="submit" loading={submitting}>
              <IdCard className="size-4" />
              إرسال الطلب
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
