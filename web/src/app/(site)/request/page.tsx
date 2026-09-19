"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Check,
  Copy,
  FilePlus2,
  Lock,
  Search,
  Timer,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError, api } from "@/lib/api";
import { useClientAuth } from "@/lib/client-auth";
import { isAbort, useFileTransfer } from "@/lib/use-transfer";
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
import { FileDropzone, formatBytes, type UploadLimits as Limits } from "@/components/site/file-dropzone";
import { PriorityPicker } from "@/components/site/priority-picker";

function Required() {
  return <span className="text-destructive">*</span>;
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
  const { upload } = useFileTransfer();
  const { client } = useClientAuth();
  const [files, setFiles] = useState<File[]>([]);
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
      // The client uploads their document here — this is the slowest thing a
      // visitor ever does on the site, so it gets the progress panel too.
      const label = files.length === 1 ? files[0].name : `${files.length} ملفات`;
      const response = await upload<{ data: PublicQuoteRequest }>(
        "/public/quote-requests",
        body,
        label,
      );
      onSubmitted(response.data);
    } catch (error) {
      if (error instanceof ApiError && error.errors) {
        setErrors(error.errors);
        toast.error("راجع الحقول المطلوبة");
      } else if (error instanceof ApiError && error.status === 429) {
        toast.error("أرسلت طلبات كثيرة خلال وقت قصير. حاول بعد قليل.");
      } else if (!isAbort(error)) {
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

      {/* The home page and the footer still send everyone here. A signed-in client
          does not need a quote and a reference number — their project can go
          straight into their own list. */}
      {client && (
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-5 py-4">
          <p className="text-sm leading-relaxed">
            لديك حساب لدينا يا {client.name} — أضف مشروعك مباشرة من حسابك دون طلب عرض سعر،
            وتابعه من «مشاريعي».
          </p>
          <Button size="sm" asChild>
            <Link href="/account/projects/new">
              <FilePlus2 className="size-4" />
              مشروع جديد
            </Link>
          </Button>
        </div>
      )}

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
              <PriorityPicker
                value={form.priority}
                onChange={(priority) => setForm((f) => ({ ...f, priority }))}
              />
            </FormSection>

            <FormSection
              title="المرفقات"
              description={`ارفع المستندات المطلوب ترجمتها. حتى ${maxFiles} ملفات، وبحد أقصى ${formatBytes(maxFileBytes)} للملف.`}
            >
              <FileDropzone files={files} onChange={setFiles} limits={limits} error={fileError} />

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
