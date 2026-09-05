"use client";

import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { ExternalLink, FileSearch, Info, Send, Upload } from "lucide-react";
import { toast } from "sonner";
import { ApiError, api, apiForm, renderedPdfUrl } from "@/lib/api";
import {
  type LetterheadTemplate,
  type PlacementPages,
  type StampPosition,
} from "@/lib/types";
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
import {
  StampPlacementButton,
  StampPlacementDialog,
} from "@/components/letterheads/stamp-placement-dialog";
import type { StampSurface } from "@/components/letterheads/stamp-positioner";

const portalAssetPath = (id: number) => `/portal/templates/${id}/asset`;

/** `pages` → the page of the document worth showing; last is the API's default. */
const pageFor = (pages: PlacementPages) => (pages === "last" ? null : 1);

/**
 * Lets a translator see their own file on the office letterhead before handing
 * it over — the header band and the stamp are exactly what they cannot judge
 * from their own document.
 *
 * The seal is placed HERE too, not only at delivery: seeing it sit on the
 * signature block is what makes a translator want to move it, so the same
 * drag surface the delivery dialog uses is one button away, and the draft is
 * rendered with the dragged position (the API honours `stamp_placements[0]`).
 *
 * The draft renders inside the dialog rather than in a new tab: the render takes
 * long enough that popup blockers eat a `window.open` after it — the office saw
 * a success toast, no tab, and concluded the system "downloads the file".
 *
 * The result is a draft: every page is watermarked, nothing is stored, and the
 * project's own letterhead/stamp are untouched. When it looks right, «متابعة
 * للتسليم» hands this exact file and seal position to the delivery dialog —
 * without it, the translator had to re-pick the file and re-drag the seal, and
 * several of them looped between preview and delivery without ever submitting.
 */
export function DraftPreviewDialog({
  open,
  onClose,
  onDeliver,
}: {
  open: boolean;
  onClose: () => void;
  /** Stage this exact file (and seal position) for delivery. */
  onDeliver: (file: File, placement: StampPosition | null) => void;
}) {
  const [letterheadId, setLetterheadId] = useState<number | null>(null);
  const [stampId, setStampId] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [placement, setPlacement] = useState<StampPosition | null>(null);
  const [positioning, setPositioning] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["portal-templates"],
    queryFn: () => api<{ data: LetterheadTemplate[] }>("/portal/templates").then((r) => r.data),
    enabled: open,
  });

  const letterheads = data?.filter((t) => t.kind === "letterhead") ?? [];
  const stamps = data?.filter((t) => t.kind === "stamp") ?? [];

  // The office runs one letterhead and one seal, so the common case needs no
  // choosing — the sole option is preselected and the picker just shows it.
  const letterhead =
    letterheads.find((t) => t.id === letterheadId) ??
    (letterheads.length === 1 ? letterheads[0] : null);
  const stamp = stamps.find((t) => t.id === stampId) ?? (stamps.length === 1 ? stamps[0] : null);

  const ready = !!file && (letterhead !== null || stamp !== null);

  /** A stale draft is worse than none — any input change discards the render. */
  function discardPreview() {
    setPreviewUrl((url) => {
      if (url) URL.revokeObjectURL(url);
      return null;
    });
  }

  function reset() {
    discardPreview();
    setLetterheadId(null);
    setStampId(null);
    setFile(null);
    setPlacement(null);
    setPositioning(false);
    setSubmitting(false);
  }

  function chooseFile(next: File | null) {
    setFile(next);
    setPlacement(null); // measured against the old document's geometry
    discardPreview();
  }

  async function loadSurface(pages: PlacementPages): Promise<StampSurface> {
    const form = new FormData();
    form.append("file", file!);
    if (letterhead) form.append("letterhead_id", String(letterhead.id));
    const page = pageFor(pages);
    if (page !== null) form.append("page", String(page));

    const response = await apiForm<{ data: StampSurface }>("/portal/stamp-surface", form);

    return response.data;
  }

  async function handlePreview() {
    if (!ready || !file) return;
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (letterhead) form.append("letterhead_id", String(letterhead.id));
      if (stamp) form.append("stamp_id", String(stamp.id));
      if (placement) form.append("stamp_placements[0]", JSON.stringify(placement));

      const url = await renderedPdfUrl("/portal/preview", form);
      setPreviewUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return url;
      });
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.errors
          ? Object.values(err.errors)[0][0]
          : err instanceof Error
            ? err.message
            : "تعذر إنشاء المعاينة",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            reset();
            onClose();
          }
        }}
      >
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>معاينة الملف بالترويسة والختم</DialogTitle>
            <DialogDescription>
              ارفع ترجمتك واختر الترويسة أو الختم لترى شكل الملف قبل التسليم — ويمكنك سحب الختم إلى
              موضعه المناسب.
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
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
                <Upload className="size-4" />
                اختر ملفاً
              </Button>
              <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                {file ? file.name : "لم يُختر ملف بعد"}
              </span>
              <StampPlacementButton
                value={placement}
                onClick={() => setPositioning(true)}
                disabled={!file || !stamp || submitting}
              />
            </div>
          </div>

          <div className="space-y-5">
            <TemplatePicker
              kind="letterhead"
              title="الترويسة"
              templates={letterheads}
              loading={isLoading}
              selectedId={letterhead?.id ?? null}
              onSelect={(id) => {
                setLetterheadId(id);
                discardPreview();
              }}
              assetPath={portalAssetPath}
              emptyHint={false}
            />
            <TemplatePicker
              kind="stamp"
              title="الختم"
              templates={stamps}
              loading={isLoading}
              selectedId={stamp?.id ?? null}
              onSelect={(id) => {
                setStampId(id);
                discardPreview();
              }}
              assetPath={portalAssetPath}
              emptyHint={false}
            />
          </div>

          {previewUrl && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">المسودة</h3>
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1 text-[13px] text-primary hover:underline"
                >
                  <ExternalLink className="size-3.5" />
                  فتح في تبويب جديد
                </a>
              </div>
              <iframe
                src={previewUrl}
                title="مسودة المعاينة"
                className="h-[480px] w-full rounded-lg border bg-muted/30"
              />
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              إغلاق
            </Button>
            <Button
              type="button"
              variant={previewUrl ? "outline" : "default"}
              onClick={handlePreview}
              loading={submitting}
              disabled={!ready}
              title={ready ? undefined : "ارفع ملفاً واختر ترويسة أو ختماً"}
            >
              <FileSearch className="size-4" />
              {previewUrl ? "تحديث المسودة" : "عرض المسودة"}
            </Button>
            {previewUrl && file && (
              <Button
                type="button"
                onClick={() => {
                  const chosen = file;
                  const chosenPlacement = placement;
                  reset();
                  onClose();
                  onDeliver(chosen, chosenPlacement);
                }}
              >
                <Send className="size-4" />
                متابعة للتسليم
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {positioning && file && (
        <StampPlacementDialog
          open
          onClose={() => setPositioning(false)}
          stamp={stamp}
          stampAssetPath={portalAssetPath}
          loadSurface={loadSurface}
          surfaceKey={`preview-${file.name}-${file.size}`}
          value={placement}
          onSave={(next) => {
            setPlacement(next);
            discardPreview();
          }}
          title={`موضع الختم — ${file.name}`}
        />
      )}
    </>
  );
}
