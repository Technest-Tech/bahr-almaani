"use client";

import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { FileSearch, Info, Upload } from "lucide-react";
import { toast } from "sonner";
import { ApiError, api, openRendered } from "@/lib/api";
import { type LetterheadTemplate } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TemplatePicker } from "@/components/letterheads/template-picker";

const portalAssetPath = (id: number) => `/portal/templates/${id}/asset`;

/**
 * Lets a translator see their own file on the office letterhead before handing
 * it over — the header band and the stamp are exactly what they cannot judge
 * from their own document.
 *
 * The result is a draft: every page is watermarked, nothing is stored, and the
 * project's own letterhead/stamp are untouched. Approval still produces the
 * certified file, which is why this dialog says so out loud.
 */
export function DraftPreviewDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [letterheadId, setLetterheadId] = useState<number | null>(null);
  const [stampId, setStampId] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["portal-templates"],
    queryFn: () => api<{ data: LetterheadTemplate[] }>("/portal/templates").then((r) => r.data),
    enabled: open,
  });

  const letterheads = data?.filter((t) => t.kind === "letterhead") ?? [];
  const stamps = data?.filter((t) => t.kind === "stamp") ?? [];
  const ready = !!file && (letterheadId !== null || stampId !== null);

  function reset() {
    setLetterheadId(null);
    setStampId(null);
    setFile(null);
    setSubmitting(false);
  }

  async function handlePreview() {
    if (!ready || !file) return;
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (letterheadId !== null) form.append("letterhead_id", String(letterheadId));
      if (stampId !== null) form.append("stamp_id", String(stampId));

      await openRendered("/portal/preview", form);
      toast.success("فُتحت المعاينة في تبويب جديد");
      reset();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.errors
          ? Object.values(err.errors)[0][0]
          : err instanceof Error
            ? err.message
            : "تعذر إنشاء المعاينة",
      );
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>معاينة الملف بالترويسة والختم</DialogTitle>
          <DialogDescription>
            ارفع ترجمتك واختر الترويسة أو الختم لترى شكل الملف قبل التسليم.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-[13px]">
          <Info className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="leading-relaxed">
            هذه <strong>مسودة للمعاينة فقط</strong> — تُطبع عليها علامة «مسودة — غير معتمدة» ولا
            تُحفظ في المشروع. الملف النهائي المعتمد يصدر بعد مراجعة مدير المشروع واعتماده.
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">ملف الترجمة</h3>
          <input
            ref={inputRef}
            type="file"
            hidden
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
              <Upload className="size-4" />
              اختر ملفاً
            </Button>
            <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
              {file ? file.name : "لم يُختر ملف بعد"}
            </span>
          </div>
        </div>

        <div className="space-y-5">
          <TemplatePicker
            kind="letterhead"
            title="الترويسة"
            templates={letterheads}
            loading={isLoading}
            selectedId={letterheadId}
            onSelect={setLetterheadId}
            assetPath={portalAssetPath}
            emptyHint={false}
          />
          <TemplatePicker
            kind="stamp"
            title="الختم"
            templates={stamps}
            loading={isLoading}
            selectedId={stampId}
            onSelect={setStampId}
            assetPath={portalAssetPath}
            emptyHint={false}
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            إلغاء
          </Button>
          <Button
            onClick={handlePreview}
            loading={submitting}
            disabled={!ready}
            title={ready ? undefined : "ارفع ملفاً واختر ترويسة أو ختماً"}
          >
            <FileSearch className="size-4" />
            عرض المسودة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
