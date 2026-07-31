"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Banknote,
  CalendarClock,
  Check,
  FileText,
  Loader2,
  Paperclip,
  Search,
  Sparkles,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import {
  PRIORITY_LABELS,
  QUOTE_STATUS_TONES,
  QUOTE_TRACK_STEPS,
  type PublicQuoteRequest,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ToneBadge } from "@/components/tone-badge";
import { cn } from "@/lib/utils";

const dateFormatter = new Intl.DateTimeFormat("ar-EG", {
  dateStyle: "long",
  timeStyle: "short",
});

export default function TrackPage() {
  return (
    <Suspense fallback={<TrackSkeleton />}>
      <TrackScreen />
    </Suspense>
  );
}

function TrackScreen() {
  // Deep links from the receipt screen and the quote email land here as ?ref=…
  const initial = useSearchParams().get("ref") ?? "";
  const [input, setInput] = useState(initial);
  const [reference, setReference] = useState(initial.trim());

  const { data, isFetching, error } = useQuery({
    queryKey: ["public-quote", reference],
    queryFn: () =>
      api<{ data: PublicQuoteRequest }>(
        `/public/quote-requests/${encodeURIComponent(reference)}`,
      ).then((response) => response.data),
    enabled: reference.length > 0,
    retry: false,
  });

  const notFound = error instanceof ApiError && error.status === 404;
  const throttled = error instanceof ApiError && error.status === 429;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <div className="text-center">
        <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          تتبع طلبك
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-pretty text-[15px] leading-relaxed text-muted-foreground">
          أدخل رقم المتابعة الذي وصلك عند إرسال الطلب لعرض حالته وعرض السعر الخاص به.
        </p>
      </div>

      <form
        className="mt-8 flex flex-wrap items-center justify-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setReference(input.trim());
        }}
      >
        <div className="relative min-w-64 flex-1 sm:max-w-md">
          <Search className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            dir="ltr"
            required
            aria-label="رقم المتابعة"
            placeholder="RQ-4KX7-9M2D"
            className="h-12 pe-10 text-center font-mono text-base tracking-widest"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
        </div>
        <Button type="submit" size="lg" className="h-12 px-6" loading={isFetching}>
          بحث
        </Button>
      </form>

      {reference && isFetching && !data && <TrackSkeleton />}

      {notFound && (
        <Card className="mt-8 border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-start gap-3 py-6">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div>
              <p className="font-medium">لم نجد طلباً بهذا الرقم</p>
              <p className="mt-1 text-sm text-muted-foreground">
                تأكد من كتابة الرقم كما وصلك تماماً. إن لم تعد تملكه، تواصل معنا
                وسنساعدك في الوصول إلى طلبك.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {throttled && (
        <Card className="mt-8 border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 py-6">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-sm">
              عدد محاولات كبير خلال وقت قصير. انتظر دقيقة ثم حاول مرة أخرى.
            </p>
          </CardContent>
        </Card>
      )}

      {data && <QuoteResult quote={data} />}

      {!reference && (
        <p className="mt-10 text-center text-sm text-muted-foreground">
          لم ترسل طلباً بعد؟{" "}
          <Link href="/request" className="font-medium text-primary hover:underline">
            اطلب عرض سعر الآن
          </Link>
        </p>
      )}
    </div>
  );
}

function QuoteResult({ quote }: { quote: PublicQuoteRequest }) {
  const currentStep = QUOTE_TRACK_STEPS.indexOf(quote.status);
  // Declined/accepted are off the happy path — mark the trail complete rather
  // than showing a request stuck at step one.
  const reachedStep = currentStep === -1 ? QUOTE_TRACK_STEPS.length - 1 : currentStep;

  return (
    <div className="mt-10 space-y-6">
      <Card className="overflow-hidden py-0">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b bg-muted/40 px-6 py-5">
            <div className="min-w-0">
              <p className="font-mono text-sm text-muted-foreground" dir="ltr">
                {quote.reference}
              </p>
              <h2 className="mt-1 truncate text-xl font-semibold">{quote.title}</h2>
            </div>
            <ToneBadge tone={QUOTE_STATUS_TONES[quote.status]} className="px-3 py-1 text-[13px]">
              {quote.status_label}
            </ToneBadge>
          </div>

          <div className="px-6 py-6">
            <p className="text-sm leading-relaxed text-muted-foreground">{quote.status_hint}</p>

            {/* Progress trail — RTL, so it reads right to left naturally */}
            <ol className="mt-7 flex items-center">
              {QUOTE_TRACK_STEPS.map((step, index) => {
                const done = index <= reachedStep;
                return (
                  <li key={step} className="flex flex-1 items-center last:flex-none">
                    <div className="flex flex-col items-center gap-2">
                      <span
                        className={cn(
                          "flex size-8 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors",
                          done
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-card text-muted-foreground",
                        )}
                      >
                        {done ? <Check className="size-4" /> : (index + 1).toLocaleString("ar-EG")}
                      </span>
                      <span
                        className={cn(
                          "whitespace-nowrap text-[11px]",
                          done ? "font-medium text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {TRACK_STEP_LABELS[index]}
                      </span>
                    </div>
                    {index < QUOTE_TRACK_STEPS.length - 1 && (
                      <span
                        aria-hidden
                        className={cn(
                          "mx-2 -mt-6 h-0.5 flex-1 rounded-full",
                          index < reachedStep ? "bg-primary" : "bg-border",
                        )}
                      />
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        </CardContent>
      </Card>

      {quote.answered && quote.quote && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-7">
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
              <Sparkles className="size-3.5" />
              عرض السعر
            </p>

            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              <div>
                <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                  <Banknote className="size-3.5" />
                  التكلفة الإجمالية
                </p>
                <p className="mt-1 text-3xl font-bold tracking-tight">
                  {Number(quote.quote.amount).toLocaleString("ar-EG", {
                    minimumFractionDigits: 2,
                  })}{" "}
                  <span className="text-lg font-semibold text-muted-foreground">
                    {quote.quote.currency}
                  </span>
                </p>
              </div>
              {quote.quote.turnaround_days !== null && (
                <div>
                  <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                    <CalendarClock className="size-3.5" />
                    مدة التنفيذ
                  </p>
                  <p className="mt-1 text-3xl font-bold tracking-tight">
                    {quote.quote.turnaround_days.toLocaleString("ar-EG")}{" "}
                    <span className="text-lg font-semibold text-muted-foreground">
                      يوم عمل
                    </span>
                  </p>
                </div>
              )}
            </div>

            {quote.quote.note && (
              <p className="mt-5 whitespace-pre-wrap rounded-xl border bg-card px-4 py-3 text-[13.5px] leading-relaxed">
                {quote.quote.note}
              </p>
            )}

            <p className="mt-5 text-xs text-muted-foreground">
              أُرسل العرض في {dateFormatter.format(new Date(quote.quote.responded_at))} — للموافقة
              عليه أو الاستفسار، ردّ على رسالة البريد أو تواصل معنا هاتفياً.
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden py-0">
        <CardContent className="p-0">
          <dl className="divide-y text-sm">
            <Row label="تاريخ الإرسال">
              {dateFormatter.format(new Date(quote.submitted_at))}
            </Row>
            {quote.source_language && quote.target_language && (
              <Row label="زوج اللغات">
                {quote.source_language.name_ar} ← {quote.target_language.name_ar}
              </Row>
            )}
            <Row label="نوع الخدمة">
              {quote.service_type === "certified" ? "ترجمة معتمدة" : "ترجمة عادية"}
            </Row>
            <Row label="الأولوية">{PRIORITY_LABELS[quote.priority]}</Row>
            {quote.declared_pages !== null && (
              <Row label="عدد الصفحات التقريبي">
                {quote.declared_pages.toLocaleString("ar-EG")}
              </Row>
            )}
            {quote.needed_by && (
              <Row label="مطلوب بحلول">
                {dateFormatter.format(new Date(quote.needed_by))}
              </Row>
            )}
            <Row label="المرفقات">
              <span className="inline-flex items-center gap-1.5">
                <Paperclip className="size-3.5 text-muted-foreground" />
                {quote.files_count.toLocaleString("ar-EG")} ملف
              </span>
            </Row>
            {quote.project_code && (
              <Row label="رقم المشروع">
                <span dir="ltr" className="font-mono">{quote.project_code}</span>
              </Row>
            )}
          </dl>
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-center gap-2 pt-2">
        <Button variant="outline" asChild>
          <Link href="/request">
            <FileText className="size-4" />
            إرسال طلب آخر
          </Link>
        </Button>
        <Button variant="ghost" asChild>
          <Link href="/">
            الصفحة الرئيسية
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

const TRACK_STEP_LABELS = ["استُلم", "قيد الدراسة", "وصلك العرض", "قيد التنفيذ"];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-3 px-6 py-3.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end font-medium">{children}</dd>
    </div>
  );
}

function TrackSkeleton() {
  return (
    <div className="mt-10 space-y-4">
      <Skeleton className="h-32 rounded-2xl" />
      <Skeleton className="h-52 rounded-2xl" />
      <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        جارٍ البحث…
      </p>
    </div>
  );
}
