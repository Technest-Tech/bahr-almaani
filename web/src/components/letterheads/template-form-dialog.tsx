"use client";

import { useRef, useState } from "react";
import { TriangleAlert, Upload } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { isAbort, useFileTransfer } from "@/lib/use-transfer";
import { contentBandStyle, placementStyle } from "@/lib/placement";
import {
  PLACEMENT_ANCHOR_LABELS,
  PLACEMENT_LAYER_LABELS,
  PLACEMENT_PAGES_LABELS,
  TEMPLATE_KIND_LABELS,
  type LetterheadTemplate,
  type Placement,
  type PlacementAnchor,
  type PlacementLayer,
  type PlacementPages,
  type TemplateKind,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/components/field";
import { useTemplateAsset } from "@/components/letterheads/template-asset";
import { cn } from "@/lib/utils";

const ANCHOR_GRID: PlacementAnchor[][] = [
  ["top-left", "top-center", "top-right"],
  ["middle-left", "middle-center", "middle-right"],
  ["bottom-left", "bottom-center", "bottom-right"],
];

const KIND_DEFAULTS: Record<TemplateKind, {
  pages: PlacementPages;
  anchor: PlacementAnchor;
  offset_x_mm: string;
  offset_y_mm: string;
  width_mm: string;
  opacity: string;
  layer: PlacementLayer;
  content_top_mm: string;
  content_bottom_mm: string;
}> = {
  letterhead: {
    pages: "all",
    anchor: "top-center",
    offset_x_mm: "0",
    offset_y_mm: "0",
    width_mm: "",
    opacity: "1",
    layer: "background",
    content_top_mm: "0",
    content_bottom_mm: "0",
  },
  stamp: {
    pages: "last",
    anchor: "bottom-right",
    offset_x_mm: "20",
    offset_y_mm: "20",
    width_mm: "45",
    opacity: "1",
    layer: "foreground",
    content_top_mm: "0",
    content_bottom_mm: "0",
  },
};

interface Props {
  open: boolean;
  template: LetterheadTemplate | null; // null = upload mode
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Above this, warn. The artwork is embedded in every merged deliverable, so a
 * 17 MB scanned letterhead turned a 20 KB translation into a 3.3 MB download —
 * which is what the client experienced as "downloads are slow".
 */
const HEAVY_ASSET_BYTES = 1024 * 1024;

/** Parent remounts via `key`, so state initializes cleanly from props. */
export function TemplateFormDialog({ open, template, onClose, onSaved }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { upload } = useFileTransfer();
  const [kind, setKind] = useState<TemplateKind>(template?.kind ?? "letterhead");
  const [name, setName] = useState(template?.name ?? "");
  const [isActive, setIsActive] = useState(template?.is_active ?? true);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [placement, setPlacement] = useState(() =>
    template
      ? {
          pages: template.placement.pages,
          anchor: template.placement.anchor,
          offset_x_mm: String(template.placement.offset_x_mm),
          offset_y_mm: String(template.placement.offset_y_mm),
          width_mm: template.placement.width_mm === null ? "" : String(template.placement.width_mm),
          opacity: String(template.placement.opacity),
          layer: template.placement.layer,
          content_top_mm: String(template.placement.content_top_mm ?? 0),
          content_bottom_mm: String(template.placement.content_bottom_mm ?? 0),
        }
      : KIND_DEFAULTS.letterhead,
  );
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  // Preview source: the freshly picked file wins, otherwise the stored asset.
  const [localAsset, setLocalAsset] = useState<{ src: string; isPdf: boolean } | null>(null);
  const { src: storedSrc } = useTemplateAsset(template?.id ?? null);
  const previewSrc = localAsset?.src ?? storedSrc;
  const previewIsPdf = localAsset ? localAsset.isPdf : template?.mime_type === "pdf";

  /** Live geometry the preview draws and the request submits. */
  const currentPlacement: Placement = {
    pages: placement.pages,
    anchor: placement.anchor,
    offset_x_mm: Number(placement.offset_x_mm || 0),
    offset_y_mm: Number(placement.offset_y_mm || 0),
    width_mm: placement.width_mm === "" ? null : Number(placement.width_mm),
    opacity: Number(placement.opacity || 1),
    layer: placement.layer,
    // Only a letterhead reserves a band; sending it for a stamp would be noise.
    ...(kind === "letterhead"
      ? {
          content_top_mm: Number(placement.content_top_mm || 0),
          content_bottom_mm: Number(placement.content_bottom_mm || 0),
        }
      : {}),
  };

  const bandStyle = kind === "letterhead" ? contentBandStyle(currentPlacement) : null;

  /** Switching kind on a fresh upload re-seeds the geometry with that kind's defaults. */
  function changeKind(next: TemplateKind) {
    setKind(next);
    setPlacement(KIND_DEFAULTS[next]);
  }

  function setPlace<K extends keyof typeof placement>(key: K, value: (typeof placement)[K]) {
    setPlacement((current) => ({ ...current, [key]: value }));
  }

  function pickFile(file: File | undefined) {
    if (localAsset) URL.revokeObjectURL(localAsset.src);
    setFileName(file?.name ?? null);
    setFileSize(file?.size ?? null);
    setLocalAsset(
      file
        ? { src: URL.createObjectURL(file), isPdf: file.type === "application/pdf" }
        : null,
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];

    if (!template && !file) {
      toast.error("اختر ملف القالب أولاً (PNG أو JPG أو PDF)");
      return;
    }

    setSubmitting(true);
    setErrors({});

    const form = new FormData();
    if (template) form.append("_method", "PUT");
    else form.append("kind", kind);
    form.append("name", name);
    form.append("is_active", isActive ? "1" : "0");
    form.append("placement", JSON.stringify(currentPlacement));
    if (file) form.append("asset", file);

    try {
      await upload(
        template ? `/letterheads/${template.id}` : "/letterheads",
        form,
        file?.name ?? name,
      );
      toast.success(template ? "تم حفظ القالب" : "تم رفع القالب");
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.errors) setErrors(err.errors);
      else if (!isAbort(err)) toast.error(err instanceof Error ? err.message : "حدث خطأ");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{template ? `تعديل: ${template.name}` : "قالب جديد"}</DialogTitle>
          <DialogDescription>
            يُدمج القالب في الملف النهائي بعد اعتماد المراجعة، وفق موضع الإرساء المحدد أدناه.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="اسم القالب" htmlFor="t-name" error={errors.name?.[0]}>
              <Input
                id="t-name"
                required
                maxLength={150}
                placeholder="مثال: ترويسة بحر المعاني الرسمية"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="النوع" htmlFor="t-kind" error={errors.kind?.[0]}>
              {template ? (
                <Input
                  id="t-kind"
                  disabled
                  value={TEMPLATE_KIND_LABELS[template.kind]}
                  title="لا يمكن تغيير النوع بعد الإنشاء"
                />
              ) : (
                <Select value={kind} onValueChange={(v) => changeKind(v as TemplateKind)}>
                  <SelectTrigger id="t-kind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TEMPLATE_KIND_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          </div>

          <Field
            label={
              <>
                ملف القالب{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  PNG أو JPG أو PDF — حتى 25 ميجابايت
                  {template ? " (اتركه فارغاً للإبقاء على الحالي)" : ""}
                </span>
              </>
            }
            error={errors.asset?.[0]}
          >
            <div className="flex items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                hidden
                accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf"
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
              <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
                <Upload className="size-4" />
                اختيار ملف
              </Button>
              <span dir="ltr" className="truncate text-start text-xs text-muted-foreground">
                {fileName ?? template?.file_name ?? "لم يُختر ملف بعد"}
              </span>
            </div>

            {fileSize !== null && fileSize > HEAVY_ASSET_BYTES && (
              <p className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <TriangleAlert className="mt-px size-3.5 shrink-0" />
                <span>
                  حجم القالب {formatBytes(fileSize)}. تُدمج صورة القالب في{" "}
                  <strong>كل ملف نهائي</strong>، فيرثه العميل مع كل تسليم — قالب بهذا
                  الحجم يجعل تحميل كل ملف أبطأ بمقدار أضعاف. يُفضَّل ملف أقل من{" "}
                  {formatBytes(HEAVY_ASSET_BYTES)} (تصدير نظيف من ملف التصميم، لا صورة
                  ممسوحة ضوئياً بدقة ٣٠٠).
                </span>
              </p>
            )}
          </Field>

          <div className="rounded-xl border bg-muted/30 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">موضع الإرساء على الصفحة</p>
                <p className="text-[13px] text-muted-foreground">
                  إحداثيات فعلية بالمليمتر على الورقة (لا تنعكس مع اتجاه النص).
                </p>
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-[auto_1fr]">
              <div className="space-y-1.5 self-start">
                {/* Physical page geometry — forced LTR so "يسار" stays the paper's left. */}
                <div
                  dir="ltr"
                  className="relative h-[178px] w-[126px] overflow-hidden rounded-md border bg-white shadow-inner"
                >
                  {previewSrc &&
                    (previewIsPdf ? (
                      <iframe
                        src={`${previewSrc}#toolbar=0&navpanes=0&scrollbar=0&view=Fit`}
                        title="معاينة الموضع"
                        tabIndex={-1}
                        // PDF templates are page-sized, so the frame keeps the A4 ratio.
                        style={{ ...placementStyle(currentPlacement), aspectRatio: "210 / 297" }}
                        className="pointer-events-none border-0"
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element -- blob/object URL
                      <img
                        src={previewSrc}
                        alt=""
                        style={placementStyle(currentPlacement)}
                        className="pointer-events-none"
                      />
                    ))}
                  {bandStyle && (
                    // The band a deliverable page is shrunk into — everything outside
                    // it belongs to the letterhead's own header/footer artwork.
                    <div
                      style={bandStyle}
                      title="نطاق النص المترجم"
                      className="pointer-events-none border-y-2 border-dashed border-emerald-500/70 bg-emerald-500/10"
                    />
                  )}
                  <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
                    {ANCHOR_GRID.flat().map((anchor) => (
                      <button
                        key={anchor}
                        type="button"
                        title={PLACEMENT_ANCHOR_LABELS[anchor]}
                        onClick={() => setPlace("anchor", anchor)}
                        className={cn(
                          "flex items-center justify-center border border-dashed transition-colors",
                          placement.anchor === anchor
                            ? "border-primary bg-primary/10"
                            : "border-slate-300/60 hover:bg-slate-900/5",
                        )}
                      >
                        <span
                          className={cn(
                            "block size-1.5 rounded-full",
                            placement.anchor === anchor ? "bg-primary" : "bg-slate-400/50",
                          )}
                        />
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-center text-[11px] text-muted-foreground">
                  معاينة على ورقة A4
                </p>
                {bandStyle && (
                  <p className="text-center text-[11px] text-emerald-600 dark:text-emerald-400">
                    المنطقة الخضراء = نطاق النص
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field label="الصفحات" htmlFor="t-pages">
                  <Select
                    value={placement.pages}
                    onValueChange={(v) => setPlace("pages", v as PlacementPages)}
                  >
                    <SelectTrigger id="t-pages" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(PLACEMENT_PAGES_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="الطبقة" htmlFor="t-layer">
                  <Select
                    value={placement.layer}
                    onValueChange={(v) => setPlace("layer", v as PlacementLayer)}
                  >
                    <SelectTrigger id="t-layer" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(PLACEMENT_LAYER_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="إزاحة أفقية (مم)" htmlFor="t-x" error={errors["placement.offset_x_mm"]?.[0]}>
                  <Input
                    id="t-x"
                    type="number"
                    step="0.5"
                    dir="ltr"
                    value={placement.offset_x_mm}
                    onChange={(e) => setPlace("offset_x_mm", e.target.value)}
                  />
                </Field>
                <Field label="إزاحة رأسية (مم)" htmlFor="t-y" error={errors["placement.offset_y_mm"]?.[0]}>
                  <Input
                    id="t-y"
                    type="number"
                    step="0.5"
                    dir="ltr"
                    value={placement.offset_y_mm}
                    onChange={(e) => setPlace("offset_y_mm", e.target.value)}
                  />
                </Field>
                <Field
                  label={
                    <>
                      العرض (مم){" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        فارغ = عرض الصفحة
                      </span>
                    </>
                  }
                  htmlFor="t-w"
                  error={errors["placement.width_mm"]?.[0]}
                >
                  <Input
                    id="t-w"
                    type="number"
                    step="0.5"
                    min={1}
                    dir="ltr"
                    placeholder="كامل العرض"
                    value={placement.width_mm}
                    onChange={(e) => setPlace("width_mm", e.target.value)}
                  />
                </Field>
                <Field label="الشفافية (0–1)" htmlFor="t-o" error={errors["placement.opacity"]?.[0]}>
                  <Input
                    id="t-o"
                    type="number"
                    step="0.05"
                    min={0}
                    max={1}
                    dir="ltr"
                    value={placement.opacity}
                    onChange={(e) => setPlace("opacity", e.target.value)}
                  />
                </Field>
              </div>
            </div>

            {kind === "letterhead" && (
              <div className="mt-5 border-t pt-4">
                <p className="text-sm font-semibold">نطاق النص المترجم</p>
                <p className="mb-3 text-[13px] text-muted-foreground">
                  ارتفاع الترويسة والتذييل المطبوعين. تُصغَّر صفحات الترجمة لتقع بينهما،
                  فلا يتداخل النص مع الشعار أو بيانات المكتب. اتركها صفراً للدمج بدون تصغير.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <Field
                    label="ارتفاع الترويسة (مم)"
                    htmlFor="t-ct"
                    error={errors["placement.content_top_mm"]?.[0]}
                  >
                    <Input
                      id="t-ct"
                      type="number"
                      step="0.5"
                      min={0}
                      max={148}
                      dir="ltr"
                      value={placement.content_top_mm}
                      onChange={(e) => setPlace("content_top_mm", e.target.value)}
                    />
                  </Field>
                  <Field
                    label="ارتفاع التذييل (مم)"
                    htmlFor="t-cb"
                    error={errors["placement.content_bottom_mm"]?.[0]}
                  >
                    <Input
                      id="t-cb"
                      type="number"
                      step="0.5"
                      min={0}
                      max={148}
                      dir="ltr"
                      value={placement.content_bottom_mm}
                      onChange={(e) => setPlace("content_bottom_mm", e.target.value)}
                    />
                  </Field>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between rounded-xl border p-4">
            <div>
              <Label htmlFor="t-active" className="text-sm font-medium">
                قالب فعّال
              </Label>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                القوالب غير الفعّالة لا تظهر عند اعتماد المشاريع.
              </p>
            </div>
            <Switch id="t-active" checked={isActive} onCheckedChange={setIsActive} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              إلغاء
            </Button>
            <Button type="submit" loading={submitting}>
              {template ? "حفظ التعديلات" : "رفع القالب"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
