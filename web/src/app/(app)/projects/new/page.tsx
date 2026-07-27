"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Client, Language, Paginated, Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";

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
          client_id: form.client_id || null,
          source_language_id: Number(form.source_language_id),
          target_language_id: Number(form.target_language_id),
          country_code: form.country_code || null,
          service_type: form.service_type,
          priority: form.priority,
          declared_pages: form.declared_pages ? Number(form.declared_pages) : null,
          deadline_at: new Date(form.deadline_at).toISOString(),
          instructions: form.instructions || null,
          quoted_amount: form.quoted_amount ? Number(form.quoted_amount) : null,
        },
      });
      router.replace(`/projects/${created.data.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.errors) setErrors(err.errors);
      else alert(err instanceof Error ? err.message : "حدث خطأ");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/projects"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-teal-700"
      >
        <ArrowRight className="size-4" />
        عودة إلى المشاريع
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>مشروع جديد</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <Label htmlFor="p-title">عنوان المشروع</Label>
              <Input
                id="p-title"
                required
                placeholder="مثال: ترجمة عقد تأسيس شركة"
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                error={errors.title?.[0]}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="p-client">العميل</Label>
                <Select
                  id="p-client"
                  value={form.client_id}
                  onChange={(e) => set("client_id", e.target.value)}
                  error={errors.client_id?.[0]}
                >
                  <option value="">— بدون عميل —</option>
                  {clients?.map((client) => (
                    <option key={client.id} value={client.id}>{client.name}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="p-country">دولة المستند</Label>
                <Input
                  id="p-country"
                  dir="ltr"
                  maxLength={2}
                  placeholder="EG"
                  value={form.country_code}
                  onChange={(e) => set("country_code", e.target.value.toUpperCase())}
                  error={errors.country_code?.[0]}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="p-source">من لغة</Label>
                <Select
                  id="p-source"
                  required
                  value={form.source_language_id}
                  onChange={(e) => set("source_language_id", e.target.value)}
                  error={errors.source_language_id?.[0]}
                >
                  <option value="">اختر اللغة…</option>
                  {languages?.map((lang) => (
                    <option key={lang.id} value={lang.id}>{lang.name_ar}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="p-target">إلى لغة</Label>
                <Select
                  id="p-target"
                  required
                  value={form.target_language_id}
                  onChange={(e) => set("target_language_id", e.target.value)}
                  error={errors.target_language_id?.[0]}
                >
                  <option value="">اختر اللغة…</option>
                  {languages?.map((lang) => (
                    <option key={lang.id} value={lang.id}>{lang.name_ar}</option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="p-service">نوع الخدمة</Label>
                <Select
                  id="p-service"
                  value={form.service_type}
                  onChange={(e) => set("service_type", e.target.value)}
                >
                  <option value="certified">ترجمة معتمدة</option>
                  <option value="regular">ترجمة عادية</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="p-priority">الأولوية</Label>
                <Select
                  id="p-priority"
                  value={form.priority}
                  onChange={(e) => set("priority", e.target.value)}
                >
                  <option value="normal">عادي</option>
                  <option value="urgent">عاجل</option>
                  <option value="critical">حرج</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="p-pages">عدد الصفحات المبدئي</Label>
                <Input
                  id="p-pages"
                  type="number"
                  min={1}
                  value={form.declared_pages}
                  onChange={(e) => set("declared_pages", e.target.value)}
                  error={errors.declared_pages?.[0]}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="p-deadline">موعد التسليم</Label>
                <Input
                  id="p-deadline"
                  type="datetime-local"
                  dir="ltr"
                  required
                  value={form.deadline_at}
                  onChange={(e) => set("deadline_at", e.target.value)}
                  error={errors.deadline_at?.[0]}
                />
              </div>
              <div>
                <Label htmlFor="p-amount">السعر المتفق عليه (جنيه)</Label>
                <Input
                  id="p-amount"
                  type="number"
                  min={0}
                  step="0.01"
                  dir="ltr"
                  value={form.quoted_amount}
                  onChange={(e) => set("quoted_amount", e.target.value)}
                  error={errors.quoted_amount?.[0]}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="p-instructions">تعليمات خاصة</Label>
              <textarea
                id="p-instructions"
                rows={3}
                placeholder="أي توجيهات للمترجم…"
                value={form.instructions}
                onChange={(e) => set("instructions", e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Link href="/projects">
                <Button type="button" variant="outline">إلغاء</Button>
              </Link>
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
