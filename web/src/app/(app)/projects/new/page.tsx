"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { Client, Language, Paginated, Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

export default function NewProjectPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    title: "",
    client_id: "",
    source_language_id: "",
    target_language_id: "",
    country_code: "",
    service_type: "certified",
    priority: "normal",
    declared_pages: "",
    deadline_at: "",
    instructions: "",
    quoted_amount: "",
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  const { data: languages } = useQuery({
    queryKey: ["languages"],
    queryFn: () => api<{ data: Language[] }>("/languages").then((r) => r.data),
    staleTime: Infinity,
  });

  const { data: clients } = useQuery({
    queryKey: ["clients", "all"],
    queryFn: () => api<Paginated<Client>>("/clients?per_page=100").then((r) => r.data),
  });

  const languageOptions =
    languages?.map((lang) => ({ value: String(lang.id), label: lang.name_ar })) ?? [];
  const clientOptions =
    clients?.map((client) => ({
      value: String(client.id),
      label: client.name,
      hint: client.type === "company" ? "شركة" : "فرد",
    })) ?? [];

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});

    try {
      const created = await api<{ data: Project }>("/projects", {
        method: "POST",
        json: {
          title: form.title,
          client_id: form.client_id ? Number(form.client_id) : null,
          source_language_id: Number(form.source_language_id),
          target_language_id: Number(form.target_language_id),
          country_code: form.country_code || null,
          service_type: form.service_type,
          priority: form.priority,
          declared_pages: form.declared_pages ? Number(form.declared_pages) : null,
          deadline_at: form.deadline_at,
          instructions: form.instructions || null,
          quoted_amount: form.quoted_amount ? Number(form.quoted_amount) : null,
        },
      });
      toast.success(`تم إنشاء المشروع ${created.data.code}`);
      router.replace(`/projects/${created.data.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.errors) {
        setErrors(err.errors);
        toast.error("راجع الحقول المطلوبة");
      } else toast.error(err instanceof Error ? err.message : "حدث خطأ");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link
        href="/projects"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowRight className="size-4" />
        عودة إلى المشاريع
      </Link>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>مشروع جديد</CardTitle>
          <CardDescription>
            يُنشأ المشروع كمسودة — ارفع ملفات العمل ثم انشره ليظهر للمترجمين.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <Field label="عنوان المشروع" htmlFor="p-title" error={errors.title?.[0]}>
              <Input
                id="p-title"
                required
                placeholder="مثال: ترجمة عقد تأسيس شركة"
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="العميل" htmlFor="p-client" error={errors.client_id?.[0]}>
                <Combobox
                  id="p-client"
                  options={clientOptions}
                  value={form.client_id}
                  onChange={(value) => set("client_id", value)}
                  placeholder="— بدون عميل —"
                  searchPlaceholder="ابحث عن عميل…"
                  clearable
                />
              </Field>
              <Field label="دولة المستند" htmlFor="p-country" error={errors.country_code?.[0]}>
                <Input
                  id="p-country"
                  dir="ltr"
                  maxLength={2}
                  placeholder="EG"
                  value={form.country_code}
                  onChange={(e) => set("country_code", e.target.value.toUpperCase())}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="من لغة" htmlFor="p-source" error={errors.source_language_id?.[0]}>
                <Combobox
                  id="p-source"
                  options={languageOptions}
                  value={form.source_language_id}
                  onChange={(value) => set("source_language_id", value)}
                  placeholder="اختر اللغة…"
                  searchPlaceholder="ابحث عن لغة…"
                />
              </Field>
              <Field label="إلى لغة" htmlFor="p-target" error={errors.target_language_id?.[0]}>
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
                <Select value={form.service_type} onValueChange={(v) => set("service_type", v)}>
                  <SelectTrigger id="p-service" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="certified">ترجمة معتمدة</SelectItem>
                    <SelectItem value="regular">ترجمة عادية</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="الأولوية" htmlFor="p-priority">
                <Select value={form.priority} onValueChange={(v) => set("priority", v)}>
                  <SelectTrigger id="p-priority" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">عادي</SelectItem>
                    <SelectItem value="urgent">عاجل</SelectItem>
                    <SelectItem value="critical">حرج</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="الصفحات المبدئية" htmlFor="p-pages" error={errors.declared_pages?.[0]}>
                <Input
                  id="p-pages"
                  type="number"
                  min={1}
                  dir="ltr"
                  value={form.declared_pages}
                  onChange={(e) => set("declared_pages", e.target.value)}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="موعد التسليم" htmlFor="p-deadline" error={errors.deadline_at?.[0]}>
                <DateTimePicker
                  id="p-deadline"
                  value={form.deadline_at}
                  onChange={(iso) => set("deadline_at", iso)}
                />
              </Field>
              <Field
                label="السعر المتفق عليه (جنيه)"
                htmlFor="p-amount"
                error={errors.quoted_amount?.[0]}
              >
                <Input
                  id="p-amount"
                  type="number"
                  min={0}
                  step="0.01"
                  dir="ltr"
                  value={form.quoted_amount}
                  onChange={(e) => set("quoted_amount", e.target.value)}
                />
              </Field>
            </div>

            <Field label="تعليمات خاصة" htmlFor="p-instructions">
              <Textarea
                id="p-instructions"
                rows={3}
                placeholder="أي توجيهات للمترجم…"
                value={form.instructions}
                onChange={(e) => set("instructions", e.target.value)}
              />
            </Field>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" asChild>
                <Link href="/projects">إلغاء</Link>
              </Button>
              <Button type="submit" loading={submitting}>
                إنشاء المشروع (مسودة)
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
