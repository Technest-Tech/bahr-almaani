"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FolderPlus, Info } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { Client, Language, Paginated, Priority, Project, QuoteRequest } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "@/components/field";

const NEW_CLIENT = "__new__";

/**
 * Turn an accepted request into a draft project.
 *
 * The languages are optional on the public form but mandatory on a project, so
 * this dialog is where a manager fills whatever the visitor left out.
 */
export function ConvertDialog({
  quote,
  open,
  onClose,
}: {
  quote: QuoteRequest;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(() => ({
    title: quote.title,
    source_language_id: quote.source_language ? String(quote.source_language.id) : "",
    target_language_id: quote.target_language ? String(quote.target_language.id) : "",
    // The visitor's requested date is a sensible default deadline when they gave one.
    deadline_at: quote.needed_by ?? "",
    priority: quote.priority as Priority,
    service_type: quote.service_type,
    quoted_amount: quote.quoted_amount ?? "",
    client_id: NEW_CLIENT,
  }));

  const { data: languages } = useQuery({
    queryKey: ["languages"],
    queryFn: () => api<{ data: Language[] }>("/languages").then((r) => r.data),
    staleTime: Infinity,
  });

  const { data: clients } = useQuery({
    queryKey: ["clients", "all"],
    queryFn: () => api<Paginated<Client>>("/clients?per_page=100").then((r) => r.data),
    enabled: open,
  });

  const languageOptions =
    languages?.map((language) => ({ value: String(language.id), label: language.name_ar })) ?? [];

  const clientOptions = [
    {
      value: NEW_CLIENT,
      label: `إنشاء عميل جديد: ${quote.organization ?? quote.name}`,
      hint: "من بيانات الطلب",
    },
    ...(clients ?? []).map((client) => ({
      value: String(client.id),
      label: client.name,
      hint: client.type === "company" ? "شركة" : "فرد",
    })),
  ];

  function set(key: keyof typeof form, value: string) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});

    try {
      const created = await api<{ data: Project }>(`/quote-requests/${quote.id}/convert`, {
        method: "POST",
        json: {
          title: form.title,
          source_language_id: Number(form.source_language_id),
          target_language_id: Number(form.target_language_id),
          deadline_at: form.deadline_at,
          priority: form.priority,
          service_type: form.service_type,
          quoted_amount: form.quoted_amount ? Number(form.quoted_amount) : null,
          client_id: form.client_id === NEW_CLIENT ? null : Number(form.client_id),
          create_client: form.client_id === NEW_CLIENT,
        },
      });
      toast.success(`أُنشئ المشروع ${created.data.code} كمسودة`);
      router.push(`/projects/${created.data.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.errors) {
        setErrors(error.errors);
        toast.error("راجع الحقول المطلوبة");
      } else {
        toast.error(error instanceof Error ? error.message : "تعذر تحويل الطلب");
      }
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>تحويل الطلب إلى مشروع</DialogTitle>
          <DialogDescription>
            سيُنشأ المشروع كمسودة، وتُنسخ مرفقات الطلب إليه كملفات عمل جاهزة للعدّ.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="عنوان المشروع" htmlFor="c-title" error={errors.title?.[0]}>
            <Input
              id="c-title"
              required
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
            />
          </Field>

          <Field label="العميل" htmlFor="c-client" error={errors.client_id?.[0]}>
            <Combobox
              id="c-client"
              options={clientOptions}
              value={form.client_id}
              onChange={(value) => set("client_id", value)}
              searchPlaceholder="ابحث عن عميل…"
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="من لغة"
              htmlFor="c-source"
              error={errors.source_language_id?.[0]}
            >
              <Combobox
                id="c-source"
                options={languageOptions}
                value={form.source_language_id}
                onChange={(value) => set("source_language_id", value)}
                placeholder="اختر اللغة…"
                searchPlaceholder="ابحث عن لغة…"
              />
            </Field>
            <Field
              label="إلى لغة"
              htmlFor="c-target"
              error={errors.target_language_id?.[0]}
            >
              <Combobox
                id="c-target"
                options={languageOptions}
                value={form.target_language_id}
                onChange={(value) => set("target_language_id", value)}
                placeholder="اختر اللغة…"
                searchPlaceholder="ابحث عن لغة…"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="موعد التسليم"
              htmlFor="c-deadline"
              error={errors.deadline_at?.[0]}
            >
              <DateTimePicker
                id="c-deadline"
                value={form.deadline_at}
                onChange={(iso) => set("deadline_at", iso)}
              />
            </Field>
            <Field
              label={`السعر المتفق عليه (${quote.currency})`}
              htmlFor="c-amount"
              error={errors.quoted_amount?.[0]}
            >
              <Input
                id="c-amount"
                type="number"
                min={0}
                step="0.01"
                dir="ltr"
                className="text-left"
                value={form.quoted_amount}
                onChange={(e) => set("quoted_amount", e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="الأولوية" htmlFor="c-priority">
              <Select value={form.priority} onValueChange={(value) => set("priority", value)}>
                <SelectTrigger id="c-priority" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">عادي</SelectItem>
                  <SelectItem value="urgent">عاجل</SelectItem>
                  <SelectItem value="critical">حرج</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="نوع الخدمة" htmlFor="c-service">
              <Select
                value={form.service_type}
                onValueChange={(value) => set("service_type", value)}
              >
                <SelectTrigger id="c-service" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="certified">ترجمة معتمدة</SelectItem>
                  <SelectItem value="regular">ترجمة عادية</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            بعد التحويل يُقفل الطلب على حالة «تحوّل إلى مشروع» ولا يمكن تحويله مرة أخرى.
            راجع الملفات وانشر المشروع من صفحته ليصل إلى المترجمين.
          </p>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              إلغاء
            </Button>
            <Button type="submit" loading={submitting}>
              <FolderPlus className="size-4" />
              إنشاء المشروع
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
