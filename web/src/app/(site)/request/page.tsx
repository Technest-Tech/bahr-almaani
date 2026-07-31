"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRef, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Check,
  Copy,
  FileText,
  Flame,
  Lock,
  Paperclip,
  Search,
  Timer,
  Trash2,
  Upload,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError, apiForm, api } from "@/lib/api";
import type { Language, Priority, PublicQuoteRequest } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/field";
import { FormSection } from "@/components/form-section";
import { cn } from "@/lib/utils";

interface Limits {
  max_files: number;
  max_file_kb: number;
  extensions: string[];
}

const PRIORITIES: { value: Priority; label: string; hint: string; icon: typeof Timer }[] = [
  { value: "normal", label: "عادي", hint: "الجدول المعتاد", icon: Timer },
  { value: "urgent", label: "عاجل", hint: "أولوية على الطابور", icon: Zap },
  { value: "critical", label: "حرج", hint: "أسرع تنفيذ ممكن", icon: Flame },
];

function Required() {
  return <span className="text-destructive">*</span>;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} م.ب`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} ك.ب`;
  return `${bytes} بايت`;
}

export default function QuoteRequestPage() {
  const [submitted, setSubmitted] = useState<PublicQuoteRequest | null>(null);

  const { data: languages } = useQuery({
    queryKey: ["public-languages"],
    queryFn: () => api<{ data: Language[] }>("/public/languages").then((r) => r.data),
    staleTime: Infinity,
  });

  const { data: limits } = useQuery({
    queryKey: ["public-quote-limits"],
    queryFn: () => api<{ data: Limits }>("/public/quote-requests/limits").then((r) => r.data),
    staleTime: Infinity,
  });

  if (submitted) return <SubmittedPanel quote={submitted} />;

  return (
    <RequestForm
      languages={languages ?? []}
      limits={limits}
      onSubmitted={(quote) => {
        setSubmitted(quote);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }}
    />
  );
}

function RequestForm({
  languages,
  limits,
  onSubmitted,
}: {
  languages: Language[];
  limits?: Limits;
  onSubmitted: (quote: PublicQuoteRequest) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    organization: "",
    title: "",
    source_language_id: "",
    target_language_id: "",
    service_type: "certified",
    priority: "normal" as Priority,
    declared_pages: "",
    needed_by: "",
    details: "",
  });

  const maxFiles = limits?.max_files ?? 10;
  const maxFileBytes = (limits?.max_file_kb ?? 25600) * 1024;

  function set(key: keyof typeof form, value: string) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  const languageOptions = languages.map((language) => ({
    value: String(language.id),
    label: language.name_ar,
  }));

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

    if (accepted.length) setFiles((current) => [...current, ...accepted]);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});

    const body = new FormData();
    body.set("name", form.name);
    body.set("email", form.email);
    if (form.phone) body.set("phone", form.phone);
    if (form.organization) body.set("organization", form.organization);
    body.set("title", form.title);
    if (form.source_language_id) body.set("source_language_id", form.source_language_id);
    if (form.target_language_id) body.set("target_language_id", form.target_language_id);
    body.set("service_type", form.service_type);
    body.set("priority", form.priority);
    if (form.declared_pages) body.set("declared_pages", form.declared_pages);
    if (form.needed_by) body.set("needed_by", form.needed_by);
    if (form.details) body.set("details", form.details);
    files.forEach((file) => body.append("files[]", file));

    try {
      const response = await apiForm<{ data: PublicQuoteRequest }>("/public/quote-requests", body);
      onSubmitted(response.data);
    } catch (error) {
      if (error instanceof ApiError && error.errors) {
        setErrors(error.errors);
        toast.error("راجع الحقول المطلوبة");
      } else if (error instanceof ApiError && error.status === 429) {
        toast.error("أرسلت طلبات كثيرة خلال وقت قصير. حاول بعد قليل.");
      } else {
        toast.error(error instanceof Error ? error.message : "تعذر إرسال الطلب");
      }
      setSubmitting(false);
    }
  }

  // Attachment errors arrive as files.0 / files.1 — surface them on the dropzone.
  const fileError = Object.entries(errors).find(([key]) => key.startsWith("files"))?.[1]?.[0];

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6">
      <div className="text-center">
        <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          اطلب عرض سعر
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-pretty text-[15px] leading-relaxed text-muted-foreground">
          أرفق مستنداتك وحدّد ما تحتاجه — نراجعها ونرسل لك التكلفة ومدة التنفيذ.
          ستحصل على رقم متابعة فور الإرسال.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <BadgeCheck className="size-3.5 text-primary" />
            بدون إنشاء حساب
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Lock className="size-3.5 text-primary" />
            ملفاتك سرية
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Timer className="size-3.5 text-primary" />
            رد خلال ساعات العمل
          </span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-10">
        <Card className="gap-0 overflow-hidden py-0">
          <CardContent className="divide-y p-0">
            <FormSection
              title="بيانات التواصل"
              description="نستخدمها لإرسال عرض السعر ومتابعة طلبك — لا نشاركها مع أي جهة."
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label={<>الاسم <Required /></>}
                  htmlFor="q-name"
                  error={errors.name?.[0]}
                >
                  <Input
                    id="q-name"
                    required
                    autoComplete="name"
                    placeholder="الاسم كما تريده في المخاطبة"
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                  />
                </Field>
                <Field
                  label={<>البريد الإلكتروني <Required /></>}
                  htmlFor="q-email"
                  error={errors.email?.[0]}
                >
                  <Input
                    id="q-email"
                    type="email"
                    required
                    dir="ltr"
                    autoComplete="email"
                    placeholder="you@example.com"
                    className="text-left"
                    value={form.email}
                    onChange={(e) => set("email", e.target.value)}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="رقم الهاتف" htmlFor="q-phone" error={errors.phone?.[0]}>
                  <Input
                    id="q-phone"
                    dir="ltr"
                    autoComplete="tel"
                    placeholder="+20 100 000 0000"
                    className="text-left"
                    value={form.phone}
                    onChange={(e) => set("phone", e.target.value)}
                  />
                </Field>
                <Field
                  label="الجهة أو الشركة"
                  htmlFor="q-org"
                  error={errors.organization?.[0]}
                >
                  <Input
                    id="q-org"
                    placeholder="اتركه فارغاً إن كان الطلب شخصياً"
                    value={form.organization}
                    onChange={(e) => set("organization", e.target.value)}
                  />
                </Field>
              </div>
            </FormSection>

            <FormSection
              title="تفاصيل الترجمة"
              description="كلما دقّت هذه البيانات، جاء عرض السعر أدق وأسرع."
            >
              <Field
                label={<>عنوان الطلب <Required /></>}
                htmlFor="q-title"
                error={errors.title?.[0]}
              >
                <Input
                  id="q-title"
                  required
                  placeholder="مثال: ترجمة عقد تأسيس شركة"
                  value={form.title}
                  onChange={(e) => set("title", e.target.value)}
                />
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label="من لغة"
                  htmlFor="q-source"
                  error={errors.source_language_id?.[0]}
                >
                  <Combobox
                    id="q-source"
                    options={languageOptions}
                    value={form.source_language_id}
                    onChange={(value) => set("source_language_id", value)}
                    placeholder="اختر اللغة…"
                    searchPlaceholder="ابحث عن لغة…"
                    clearable
                  />
                </Field>
                <Field
                  label="إلى لغة"
                  htmlFor="q-target"
                  error={errors.target_language_id?.[0]}
                >
                  <Combobox
                    id="q-target"
                    options={languageOptions}
                    value={form.target_language_id}
                    onChange={(value) => set("target_language_id", value)}
                    placeholder="اختر اللغة…"
                    searchPlaceholder="ابحث عن لغة…"
                    clearable
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="نوع الخدمة" htmlFor="q-service">
                  <Select
                    value={form.service_type}
                    onValueChange={(value) => set("service_type", value)}
                  >
                    <SelectTrigger id="q-service" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="certified">ترجمة معتمدة (بختم)</SelectItem>
                      <SelectItem value="regular">ترجمة عادية</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  label="عدد الصفحات التقريبي"
                  htmlFor="q-pages"
                  error={errors.declared_pages?.[0]}
                >
                  <Input
                    id="q-pages"
                    type="number"
                    min={1}
                    dir="ltr"
                    className="text-left"
                    placeholder="12"
                    value={form.declared_pages}
                    onChange={(e) => set("declared_pages", e.target.value)}
                  />
                </Field>
                <Field
                  label="تحتاجه بحلول"
                  htmlFor="q-needed"
                  error={errors.needed_by?.[0]}
                >
                  <DateTimePicker
                    id="q-needed"
                    value={form.needed_by}
                    onChange={(iso) => set("needed_by", iso)}
                  />
                </Field>
              </div>
            </FormSection>

            <FormSection
              title="الأولوية"
              description="الأولوية الأعلى تعني موضعاً أسبق في جدول التنفيذ، وقد تؤثر على التكلفة."
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {PRIORITIES.map((option) => {
                  const active = form.priority === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setForm((f) => ({ ...f, priority: option.value }))}
                      className={cn(
                        "flex items-start gap-3 rounded-xl border p-4 text-start transition-all",
                        active
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "hover:border-primary/40 hover:bg-accent/50",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-lg",
                          active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                        )}
                      >
                        <option.icon className="size-4" />
                      </span>
                      <span className="grid gap-0.5">
                        <span className="text-sm font-semibold">{option.label}</span>
                        <span className="text-xs text-muted-foreground">{option.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </FormSection>

            <FormSection
              title="المرفقات"
              description={`ارفع المستندات المطلوب ترجمتها. حتى ${maxFiles} ملفات، وبحد أقصى ${formatBytes(maxFileBytes)} للملف.`}
            >
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
                    {(limits?.extensions ?? ["pdf", "docx", "xlsx", "jpg", "png"])
                      .slice(0, 8)
                      .join(", ")}
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

              {fileError && <p className="text-xs text-destructive">{fileError}</p>}

              {files.length > 0 && (
                <ul className="divide-y overflow-hidden rounded-xl border">
                  {files.map((file, index) => (
                    <li
                      key={`${file.name}-${index}`}
                      className="flex items-center gap-3 bg-card px-4 py-2.5"
                    >
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-[13px]">{file.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatBytes(file.size)}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`حذف ${file.name}`}
                        onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              <p className="text-xs text-muted-foreground">
                لا تملك نسخة إلكترونية؟ صوّر المستند بهاتفك وأرفق الصورة — نتعامل مع
                المستندات الممسوحة ضوئياً.
              </p>
            </FormSection>

            <FormSection
              title="تفاصيل إضافية"
              description="أي شيء يساعدنا على تسعير الطلب بدقة: جهة التقديم، صيغة مطلوبة، مصطلحات معتمدة."
            >
              <Field label="تفاصيل الطلب" htmlFor="q-details" error={errors.details?.[0]}>
                <Textarea
                  id="q-details"
                  rows={4}
                  placeholder="مثال: المستند مطلوب للسفارة الألمانية، ويحتاج ختم المكتب على كل صفحة."
                  value={form.details}
                  onChange={(e) => set("details", e.target.value)}
                />
              </Field>
            </FormSection>
          </CardContent>

          <CardFooter className="flex-wrap justify-between gap-3 border-t bg-muted/40 py-4!">
            <p className="text-xs text-muted-foreground">
              بإرسال الطلب أنت توافق على تواصلنا معك بخصوصه.
            </p>
            <Button type="submit" size="lg" loading={submitting}>
              إرسال الطلب والحصول على رقم متابعة
              <ArrowLeft className="size-4" />
            </Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}

/** Post-submit receipt. The reference is the only thing they must keep, so it dominates. */
function SubmittedPanel({ quote }: { quote: PublicQuoteRequest }) {
  const [copied, setCopied] = useState(false);

  async function copyReference() {
    try {
      await navigator.clipboard.writeText(quote.reference);
      setCopied(true);
      toast.success("تم نسخ رقم المتابعة");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("تعذر النسخ — انسخ الرقم يدوياً");
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
      <div className="text-center">
        <span className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <Check className="size-8" />
        </span>
        <h1 className="mt-6 text-3xl font-bold tracking-tight">استلمنا طلبك</h1>
        <p className="mx-auto mt-3 max-w-md text-pretty text-[15px] leading-relaxed text-muted-foreground">
          سيراجع فريقنا ملفاتك ويرسل عرض السعر على{" "}
          <span className="font-medium text-foreground">بريدك الإلكتروني</span>. يمكنك
          أيضاً متابعة الطلب في أي وقت بالرقم التالي.
        </p>
      </div>

      <Card className="mt-8 border-primary/30 bg-primary/5">
        <CardContent className="py-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            رقم المتابعة
          </p>
          <p
            dir="ltr"
            className="mt-3 font-mono text-3xl font-bold tracking-[0.2em] sm:text-4xl"
          >
            {quote.reference}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Button variant="outline" onClick={copyReference}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "تم النسخ" : "نسخ الرقم"}
            </Button>
            <Button asChild>
              <Link href={`/track?ref=${quote.reference}`}>
                <Search className="size-4" />
                تتبع الطلب الآن
              </Link>
            </Button>
          </div>
          <p className="mt-6 text-xs text-muted-foreground">
            احتفظ بهذا الرقم — هو مفتاح الاطلاع على عرض السعر وحالة الطلب.
          </p>
        </CardContent>
      </Card>

      <dl className="mt-8 divide-y overflow-hidden rounded-2xl border bg-card text-sm">
        <div className="flex justify-between gap-4 px-5 py-3.5">
          <dt className="text-muted-foreground">الطلب</dt>
          <dd className="text-end font-medium">{quote.title}</dd>
        </div>
        <div className="flex justify-between gap-4 px-5 py-3.5">
          <dt className="text-muted-foreground">الحالة</dt>
          <dd className="text-end font-medium">{quote.status_label}</dd>
        </div>
        <div className="flex justify-between gap-4 px-5 py-3.5">
          <dt className="text-muted-foreground">المرفقات</dt>
          <dd className="text-end font-medium">
            {quote.files_count.toLocaleString("ar-EG")} ملف
          </dd>
        </div>
      </dl>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        <Link href="/" className="text-primary hover:underline">
          العودة إلى الصفحة الرئيسية
        </Link>
      </p>
    </div>
  );
}
