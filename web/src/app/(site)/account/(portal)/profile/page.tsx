"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { clientApi, useClientAuth } from "@/lib/client-auth";
import type { ClientAccount } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "@/components/field";
import { FormSection } from "@/components/form-section";

const dateFormatter = new Intl.DateTimeFormat("ar-EG", { dateStyle: "long" });

export default function AccountProfilePage() {
  const { client, refresh } = useClientAuth();

  if (!client) return null;

  return (
    <div className="space-y-5">
      <DetailsForm client={client} onSaved={refresh} />
      <PasswordForm />

      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        عضو منذ {dateFormatter.format(new Date(client.member_since))}
        {client.last_login_at && (
          <> · آخر دخول {dateFormatter.format(new Date(client.last_login_at))}</>
        )}
      </p>
    </div>
  );
}

function DetailsForm({
  client,
  onSaved,
}: {
  client: ClientAccount;
  onSaved: (client: ClientAccount) => void;
}) {
  const [form, setForm] = useState({
    name: client.name,
    type: client.type,
    phone: client.phone ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    setSubmitting(true);
    try {
      const data = await clientApi<{ client: ClientAccount }>("/client/auth/me", {
        method: "PUT",
        json: form,
      });
      onSaved(data.client);
      toast.success("تم حفظ بياناتك");
    } catch (err) {
      if (err instanceof ApiError && err.errors) setErrors(err.errors);
      else toast.error(err instanceof Error ? err.message : "حدث خطأ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="overflow-hidden py-0">
      <form onSubmit={handleSubmit}>
        <CardContent className="p-0">
          <FormSection
            title="بيانات التواصل"
            description="نستخدم هذه البيانات في مراسلاتك وفي رأس الفواتير."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="الاسم" htmlFor="p-name" error={errors.name?.[0]}>
                <Input
                  id="p-name"
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </Field>
              <Field label="نوع الحساب" htmlFor="p-type">
                <Select
                  value={form.type}
                  onValueChange={(value) =>
                    setForm((f) => ({ ...f, type: value as ClientAccount["type"] }))
                  }
                >
                  <SelectTrigger id="p-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="individual">فرد</SelectItem>
                    <SelectItem value="company">شركة</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="الهاتف" htmlFor="p-phone" error={errors.phone?.[0]}>
                <Input
                  id="p-phone"
                  dir="ltr"
                  className="text-left"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </Field>
              {/* The address is the login identity; changing it needs the office. */}
              <Field
                label="البريد الإلكتروني"
                htmlFor="p-email"
                hint="لتغيير البريد تواصل مع المكتب — هو معرّف الدخول."
              >
                <Input id="p-email" dir="ltr" className="text-left" value={client.email} disabled />
              </Field>
            </div>
          </FormSection>
        </CardContent>
        <CardFooter className="justify-end border-t bg-muted/40 py-4!">
          <Button type="submit" loading={submitting}>
            حفظ التعديلات
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function PasswordForm() {
  const [form, setForm] = useState({
    current_password: "",
    password: "",
    password_confirmation: "",
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    setSubmitting(true);
    try {
      await clientApi("/client/auth/me/password", { method: "PUT", json: form });
      setForm({ current_password: "", password: "", password_confirmation: "" });
      toast.success("تم تغيير كلمة المرور، وسُجّل الخروج من الأجهزة الأخرى");
    } catch (err) {
      if (err instanceof ApiError && err.errors) setErrors(err.errors);
      else toast.error(err instanceof Error ? err.message : "حدث خطأ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="overflow-hidden py-0">
      <form onSubmit={handleSubmit}>
        <CardContent className="p-0">
          <FormSection
            title="كلمة المرور"
            description="تغيير كلمة المرور يسجّل الخروج من كل الأجهزة الأخرى."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="كلمة المرور الحالية"
                htmlFor="p-current"
                error={errors.current_password?.[0]}
              >
                <Input
                  id="p-current"
                  type="password"
                  dir="ltr"
                  className="text-left"
                  autoComplete="current-password"
                  required
                  value={form.current_password}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, current_password: e.target.value }))
                  }
                />
              </Field>
              <div className="hidden sm:block" />
              <Field
                label="كلمة المرور الجديدة"
                htmlFor="p-new"
                error={errors.password?.[0]}
                hint="٨ أحرف على الأقل"
              >
                <Input
                  id="p-new"
                  type="password"
                  dir="ltr"
                  className="text-left"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                />
              </Field>
              <Field label="تأكيد كلمة المرور" htmlFor="p-confirm">
                <Input
                  id="p-confirm"
                  type="password"
                  dir="ltr"
                  className="text-left"
                  autoComplete="new-password"
                  required
                  value={form.password_confirmation}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, password_confirmation: e.target.value }))
                  }
                />
              </Field>
            </div>
          </FormSection>
        </CardContent>
        <CardFooter className="justify-end border-t bg-muted/40 py-4!">
          <Button type="submit" loading={submitting}>
            تغيير كلمة المرور
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
