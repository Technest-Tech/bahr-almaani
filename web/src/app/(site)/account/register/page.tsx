"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { ApiError } from "@/lib/api";
import { useClientAuth } from "@/lib/client-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "@/components/field";

export default function ClientRegisterPage() {
  const router = useRouter();
  const { client, loading, register } = useClientAuth();
  const [form, setForm] = useState({
    name: "",
    type: "individual" as "individual" | "company",
    phone: "",
    email: "",
    password: "",
    password_confirmation: "",
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && client) router.replace("/account");
  }, [loading, client, router]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    setMessage(null);
    setSubmitting(true);
    try {
      await register({ ...form, phone: form.phone || undefined });
      router.replace("/account");
    } catch (err) {
      if (err instanceof ApiError && err.errors) setErrors(err.errors);
      else setMessage(err instanceof ApiError ? err.message : "تعذر الاتصال بالخادم.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-14 sm:px-6">
      <div className="text-center">
        <h1 className="text-balance text-3xl font-bold tracking-tight">إنشاء حساب عميل</h1>
        <p className="mt-3 text-pretty text-[15px] leading-relaxed text-muted-foreground">
          حساب واحد يجمع مشاريعك وملفاتك المعتمدة وفواتيرك في مكان واحد.
        </p>
      </div>

      <Card className="mt-8">
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="الاسم" htmlFor="cr-name" error={errors.name?.[0]}>
                <Input
                  id="cr-name"
                  required
                  autoComplete="name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </Field>
              <Field label="نوع الحساب" htmlFor="cr-type">
                <Select
                  value={form.type}
                  onValueChange={(value) =>
                    setForm((f) => ({ ...f, type: value as "individual" | "company" }))
                  }
                >
                  <SelectTrigger id="cr-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="individual">فرد</SelectItem>
                    <SelectItem value="company">شركة</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="البريد الإلكتروني" htmlFor="cr-email" error={errors.email?.[0]}>
                <Input
                  id="cr-email"
                  type="email"
                  dir="ltr"
                  autoComplete="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="text-left"
                />
              </Field>
              <Field label="الهاتف" htmlFor="cr-phone" error={errors.phone?.[0]}>
                <Input
                  id="cr-phone"
                  dir="ltr"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  className="text-left"
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="كلمة المرور"
                htmlFor="cr-password"
                error={errors.password?.[0]}
                hint="٨ أحرف على الأقل"
              >
                <Input
                  id="cr-password"
                  type="password"
                  dir="ltr"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  className="text-left"
                />
              </Field>
              <Field label="تأكيد كلمة المرور" htmlFor="cr-password2">
                <Input
                  id="cr-password2"
                  type="password"
                  dir="ltr"
                  autoComplete="new-password"
                  required
                  value={form.password_confirmation}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, password_confirmation: e.target.value }))
                  }
                  className="text-left"
                />
              </Field>
            </div>

            {message && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {message}
              </p>
            )}

            <Button type="submit" className="w-full" size="lg" loading={submitting}>
              <UserPlus className="size-4" />
              إنشاء الحساب
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        لديك حساب بالفعل؟{" "}
        <Link href="/account/login" className="font-medium text-primary hover:underline">
          تسجيل الدخول
        </Link>
      </p>
    </div>
  );
}
