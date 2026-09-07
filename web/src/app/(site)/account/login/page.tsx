"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LogIn } from "lucide-react";
import { ApiError } from "@/lib/api";
import { useClientAuth } from "@/lib/client-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/field";

export default function ClientLoginPage() {
  const router = useRouter();
  const { client, loading, login } = useClientAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && client) router.replace("/account");
  }, [loading, client, router]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      router.replace("/account");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (err.errors?.email?.[0] ?? err.message)
          : "تعذر الاتصال بالخادم. حاول مرة أخرى.",
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-14 sm:px-6">
      <div className="text-center">
        <h1 className="text-balance text-3xl font-bold tracking-tight">دخول العملاء</h1>
        <p className="mt-3 text-pretty text-[15px] leading-relaxed text-muted-foreground">
          تابع مشاريعك وحمّل ملفاتك المعتمدة واطّلع على فواتيرك.
        </p>
      </div>

      <Card className="mt-8">
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="البريد الإلكتروني" htmlFor="ca-email">
              <Input
                id="ca-email"
                type="email"
                dir="ltr"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="text-left"
              />
            </Field>
            <Field label="كلمة المرور" htmlFor="ca-password">
              <Input
                id="ca-password"
                type="password"
                dir="ltr"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="text-left"
              />
            </Field>

            {error && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" size="lg" loading={submitting}>
              <LogIn className="size-4" />
              تسجيل الدخول
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        ليس لديك حساب؟{" "}
        <Link href="/account/register" className="font-medium text-primary hover:underline">
          أنشئ حساباً جديداً
        </Link>
      </p>

      <p className="mt-3 text-center text-xs leading-relaxed text-muted-foreground">
        تعاملت معنا سابقاً ولا تملك حساباً؟ تواصل مع المكتب لتفعيل حسابك على نفس ملفك، فتظهر لك
        مشاريعك السابقة كاملة.
      </p>

      {/* Staff have their own door; keeping it visible here stops PMs landing on
          the client form and wondering why their password is refused. */}
      <p className="mt-8 text-center text-xs text-muted-foreground">
        موظف في المكتب؟{" "}
        <Link href="/login" className="underline underline-offset-4 hover:text-foreground">
          دخول فريق العمل
        </Link>
      </p>
    </div>
  );
}
