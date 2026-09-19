"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { ApiError, api } from "@/lib/api";
import { isAbort, useFileTransfer } from "@/lib/use-transfer";
import type { ClientProject, Language, Priority } from "@/lib/types";
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
import { FileDropzone, formatBytes, type UploadLimits } from "@/components/site/file-dropzone";
import { PriorityPicker } from "@/components/site/priority-picker";

function Required() {
  return <span className="text-destructive">*</span>;
}

/**
 * A new project, from the client's own area.
 *
 * The public quote form minus the contact section — the account already says who
 * they are — and it lands as a project in their list, not as a quote with a
 * reference to keep. The office still reviews it before any translation starts.
 */
export default function NewAccountProjectPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { upload } = useFileTransfer();
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    title: "",
    source_language_id: "",
    target_language_id: "",
    service_type: "certified",
    priority: "normal" as Priority,
    declared_pages: "",
    deadline_at: "",
    instructions: "",
  });

  // The same public catalogue and limits the quote form reads — one intake, one set of rules.
  const { data: languages } = useQuery({
    queryKey: ["public-languages"],
    queryFn: () => api<{ data: Language[] }>("/public/languages").then((r) => r.data),
    staleTime: Infinity,
  });

  const { data: limits } = useQuery({
    queryKey: ["public-quote-limits"],
    queryFn: () => api<{ data: UploadLimits }>("/public/quote-requests/limits").then((r) => r.data),
    staleTime: Infinity,
  });

  const maxFiles = limits?.max_files ?? 10;
  const maxFileBytes = (limits?.max_file_kb ?? 25600) * 1024;

  const languageOptions = (languages ?? []).map((language) => ({
    value: String(language.id),
    label: language.name_ar,
  }));

  function set(key: keyof typeof form, value: string) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    // The browser can't mark a file list or a picker as required — say it here,
    // before a slow line spends time uploading a request that will bounce.
    const missing: Record<string, string[]> = {};
    if (!form.source_language_id) missing.source_language_id = ["اختر لغة المستند"];
    if (!form.target_language_id) missing.target_language_id = ["اختر اللغة المطلوبة"];
    if (!form.deadline_at) missing.deadline_at = ["حدد الموعد الذي تحتاجه فيه"];
    if (files.length === 0) missing.files = ["أرفق مستنداً واحداً على الأقل"];
    if (Object.keys(missing).length > 0) {
      setErrors(missing);
      toast.error("راجع الحقول المطلوبة");
      return;
    }

    setSubmitting(true);
    setErrors({});

    const body = new FormData();
    if (form.title.trim()) body.set("title", form.title.trim());
    body.set("source_language_id", form.source_language_id);
    body.set("target_language_id", form.target_language_id);
    body.set("service_type", form.service_type);
    body.set("priority", form.priority);
    if (form.declared_pages) body.set("declared_pages", form.declared_pages);
    body.set("deadline_at", form.deadline_at);
    if (form.instructions.trim()) body.set("instructions", form.instructions.trim());
    files.forEach((file) => body.append("files[]", file));

    try {
      const label = files.length === 1 ? files[0].name : `${files.length} ملفات`;
      const response = await upload<{ data: ClientProject; message: string }>(
        "/client/projects",
        body,
        label,
        { realm: "client" },
      );
      toast.success(response.message);
      queryClient.invalidateQueries({ queryKey: ["client-overview"] });
      queryClient.invalidateQueries({ queryKey: ["client-projects"] });
      router.push(`/account/projects/${response.data.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.errors) {
        setErrors(error.errors);
        toast.error("راجع الحقول المطلوبة");
      } else if (error instanceof ApiError && error.status === 429) {
        toast.error("أرسلت ملفات كثيرة خلال وقت قصير. حاول بعد قليل.");
      } else if (!isAbort(error)) {
        toast.error(error instanceof Error ? error.message : "تعذر إرسال المشروع");
      }
      setSubmitting(false);
    }
  }

  // Attachment errors arrive as files / files.0 / files.1 — surface them on the dropzone.
  const fileError = Object.entries(errors).find(([key]) => key.startsWith("files"))?.[1]?.[0];

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" asChild className="-ms-2">
        <Link href="/account/projects">
          <ArrowRight className="size-4" />
          كل المشاريع
        </Link>
      </Button>

      <div>
        <h2 className="text-xl font-semibold">مشروع جديد</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          أرفق المستندات المطلوب ترجمتها وحدّد ما تحتاجه. يظهر المشروع في «مشاريعي» فوراً،
          ويراجعه المكتب لتأكيد الموعد والتكلفة قبل بدء الترجمة.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <Card className="gap-0 overflow-hidden py-0">
          <CardContent className="divide-y p-0">
            <FormSection
              title="المستندات"
              description={`الملفات المطلوب ترجمتها. حتى ${maxFiles} ملفات، وبحد أقصى ${formatBytes(maxFileBytes)} للملف.`}
            >
              <FileDropzone files={files} onChange={setFiles} limits={limits} error={fileError} />
              <p className="text-xs text-muted-foreground">
                لا تملك نسخة إلكترونية؟ صوّر المستند بهاتفك وأرفق الصورة — نتعامل مع
                المستندات الممسوحة ضوئياً.
              </p>
            </FormSection>

            <FormSection
              title="تفاصيل الترجمة"
              description="اسم المشروع اختياري — إن تركته فارغاً سمّيناه باسم أول ملف."
            >
              <Field label="اسم المشروع" htmlFor="p-title" error={errors.title?.[0]}>
                <Input
                  id="p-title"
                  placeholder="مثال: ترجمة عقد تأسيس شركة"
                  value={form.title}
                  onChange={(e) => set("title", e.target.value)}
                />
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label={<>من لغة <Required /></>}
                  htmlFor="p-source"
                  error={errors.source_language_id?.[0]}
                >
                  <Combobox
                    id="p-source"
                    options={languageOptions}
                    value={form.source_language_id}
                    onChange={(value) => set("source_language_id", value)}
                    placeholder="اختر اللغة…"
                    searchPlaceholder="ابحث عن لغة…"
                  />
                </Field>
                <Field
                  label={<>إلى لغة <Required /></>}
                  htmlFor="p-target"
                  error={errors.target_language_id?.[0]}
                >
                  <Combobox
                    id="p-target"
                    options={languageOptions}
                    value={form.target_language_id}
                    onChange={(value) => set("target_language_id", value)}
                    placeholder="اختر اللغة…"
                    searchPlaceholder="ابحث عن لغة…"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="نوع الخدمة" htmlFor="p-service">
                  <Select
                    value={form.service_type}
                    onValueChange={(value) => set("service_type", value)}
                  >
                    <SelectTrigger id="p-service" className="w-full">
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
                  htmlFor="p-pages"
                  error={errors.declared_pages?.[0]}
                >
                  <Input
                    id="p-pages"
                    type="number"
                    min={1}
                    dir="ltr"
                    className="text-start"
                    placeholder="12"
                    value={form.declared_pages}
                    onChange={(e) => set("declared_pages", e.target.value)}
                  />
                </Field>
                <Field
                  label={<>تحتاجه بحلول <Required /></>}
                  htmlFor="p-deadline"
                  error={errors.deadline_at?.[0]}
                >
                  <DateTimePicker
                    id="p-deadline"
                    value={form.deadline_at}
                    onChange={(iso) => set("deadline_at", iso)}
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
              title="ملاحظات للمكتب"
              description="جهة التقديم، صيغة مطلوبة، مصطلحات معتمدة — أي شيء يساعدنا على تنفيذ المشروع كما تريده."
            >
              <Field label="الملاحظات" htmlFor="p-notes" error={errors.instructions?.[0]}>
                <Textarea
                  id="p-notes"
                  rows={4}
                  placeholder="مثال: المستند مطلوب للسفارة الألمانية، ويحتاج ختم المكتب على كل صفحة."
                  value={form.instructions}
                  onChange={(e) => set("instructions", e.target.value)}
                />
              </Field>
            </FormSection>
          </CardContent>

          <CardFooter className="flex-wrap justify-between gap-3 border-t bg-muted/40 py-4!">
            <p className="text-xs text-muted-foreground">
              لن يبدأ العمل قبل أن يراجع المكتب المشروع ويؤكد الموعد.
            </p>
            <Button type="submit" size="lg" loading={submitting}>
              إرسال المشروع
              <ArrowLeft className="size-4" />
            </Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
