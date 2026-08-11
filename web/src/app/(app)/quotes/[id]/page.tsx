"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import {
  ArrowRight,
  Banknote,
  Building2,
  CalendarClock,
  Check,
  Copy,
  Download,
  FileText,
  FolderKanban,
  FolderPlus,
  Globe,
  Mail,
  MapPin,
  Phone,
  Send,
  Trash2,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useFileTransfer } from "@/lib/use-transfer";
import { useAuth } from "@/lib/auth";
import {
  PRIORITY_LABELS,
  PRIORITY_TONES,
  QUOTE_STATUS_TONES,
  type QuoteRequest,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { ToneBadge } from "@/components/tone-badge";
import { useConfirm } from "@/components/confirm";
import { ConvertDialog } from "@/components/quotes/convert-dialog";
import { RespondDialog } from "@/components/quotes/respond-dialog";

const dateFormatter = new Intl.DateTimeFormat("ar-EG", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} م.ب`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} ك.ب`;
  return `${bytes} بايت`;
}

export default function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const { download } = useFileTransfer();
  const { confirm } = useConfirm();
  const queryClient = useQueryClient();
  const [responding, setResponding] = useState(false);
  const [converting, setConverting] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: quote, isLoading } = useQuery({
    queryKey: ["quote-request", id],
    queryFn: () => api<{ data: QuoteRequest }>(`/quote-requests/${id}`).then((r) => r.data),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["quote-request", id] });
    queryClient.invalidateQueries({ queryKey: ["quote-requests"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      api(`/quote-requests/${id}/status`, { method: "PUT", json: { status } }),
    onSuccess: () => {
      invalidate();
      toast.success("تم تحديث حالة الطلب");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "حدث خطأ"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api(`/quote-requests/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quote-requests"] });
      toast.success("تم حذف الطلب");
      window.location.href = "/quotes";
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "حدث خطأ"),
  });

  if (isLoading || !quote) {
    return (
      <div className="w-full space-y-5">
        <Skeleton className="h-20" />
        <div className="grid gap-4 xl:grid-cols-3">
          <Skeleton className="h-96 xl:col-span-2" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  // Pricing and converting are separate jobs: the accountant answers the client,
  // the PM turns an accepted quote into scheduled work.
  const manage = can("quotes.manage");
  const canConvert = can("quotes.convert");
  const locked = quote.status === "converted";

  async function copyReference() {
    if (!quote) return;
    try {
      await navigator.clipboard.writeText(quote.reference);
      setCopied(true);
      toast.success("تم نسخ رقم المتابعة");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("تعذر النسخ");
    }
  }

  return (
    <div className="w-full space-y-5">
      <div className="space-y-3">
        <Link
          href="/quotes"
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowRight className="size-3.5" />
          عودة إلى طلبات التسعير
        </Link>

        <PageHeader title={quote.title} description={`وصل في ${dateFormatter.format(new Date(quote.created_at))}`}>
          {manage && !locked && (
            <>
              {quote.status === "new" && (
                <Button
                  variant="outline"
                  onClick={() => statusMutation.mutate("reviewing")}
                  loading={statusMutation.isPending}
                >
                  بدء الدراسة
                </Button>
              )}
              <Button onClick={() => setResponding(true)}>
                <Send className="size-4" />
                {quote.responded_at ? "تعديل العرض" : "إرسال عرض السعر"}
              </Button>
              {quote.responded_at && quote.status !== "accepted" && (
                <Button
                  variant="outline"
                  onClick={() => statusMutation.mutate("accepted")}
                  loading={statusMutation.isPending}
                >
                  <Check className="size-4" />
                  العميل وافق
                </Button>
              )}
              {quote.status === "accepted" && canConvert && (
                <Button onClick={() => setConverting(true)}>
                  <FolderPlus className="size-4" />
                  تحويل إلى مشروع
                </Button>
              )}
            </>
          )}
        </PageHeader>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ToneBadge tone={QUOTE_STATUS_TONES[quote.status]} className="px-2.5 py-1">
          {quote.status_label}
        </ToneBadge>
        <ToneBadge tone={PRIORITY_TONES[quote.priority]}>
          {PRIORITY_LABELS[quote.priority]}
        </ToneBadge>
        <ToneBadge tone="slate">
          {quote.service_type === "certified" ? "ترجمة معتمدة" : "ترجمة عادية"}
        </ToneBadge>
        <button
          onClick={copyReference}
          title="نسخ رقم المتابعة"
          className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 font-mono text-xs transition-colors hover:border-primary/40 hover:text-primary"
          dir="ltr"
        >
          {quote.reference}
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </button>
      </div>

      {quote.project && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <p className="flex items-center gap-2 text-sm">
              <FolderKanban className="size-4 text-primary" />
              حُوّل هذا الطلب إلى المشروع{" "}
              <span dir="ltr" className="font-mono font-medium">{quote.project.code}</span>
              <ToneBadge tone="slate">{quote.project.status_label}</ToneBadge>
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/projects/${quote.project.id}`}>فتح المشروع</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Without this an accepted request reads as stuck to an accountant, who has
          answered the client but cannot open the project themselves. */}
      {quote.status === "accepted" && !canConvert && !quote.project && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-center gap-3 py-4">
            <FolderPlus className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-sm">
              العميل وافق على العرض — بانتظار مدير المشاريع لتحويل الطلب إلى مشروع وبدء
              التنفيذ.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-4!">
              <CardTitle className="text-sm">تفاصيل الطلب</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <dl className="divide-y text-sm">
                <Row label="زوج اللغات">
                  {quote.source_language && quote.target_language ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Globe className="size-3.5 text-muted-foreground" />
                      {quote.source_language.name_ar} ← {quote.target_language.name_ar}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">لم يحدده العميل</span>
                  )}
                </Row>
                <Row label="عدد الصفحات التقريبي">
                  {quote.declared_pages?.toLocaleString("ar-EG") ?? "—"}
                </Row>
                <Row label="مطلوب بحلول">
                  {quote.needed_by ? (
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarClock className="size-3.5 text-muted-foreground" />
                      {dateFormatter.format(new Date(quote.needed_by))}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">غير محدد</span>
                  )}
                </Row>
                {quote.details && (
                  <div className="px-5 py-4">
                    <dt className="text-muted-foreground">تفاصيل العميل</dt>
                    <dd className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/50 px-3.5 py-3 text-[13.5px] leading-relaxed">
                      {quote.details}
                    </dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-4!">
              <CardTitle className="text-sm">
                المرفقات
                {!!quote.files?.length && (
                  <span className="ms-2 text-xs font-normal text-muted-foreground">
                    {quote.files.length.toLocaleString("ar-EG")} ملف
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {!quote.files?.length ? (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  لم يرفق العميل أي ملفات — قد تحتاج التواصل معه لتقدير الحجم.
                </p>
              ) : (
                <ul className="divide-y">
                  {quote.files.map((file) => (
                    <li key={file.id} className="flex items-center gap-3 px-5 py-3">
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{file.original_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatBytes(file.size_bytes)}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="تنزيل"
                        onClick={() =>
                          download(
                            `/quote-requests/${quote.id}/files/${file.id}`,
                            file.original_name,
                          ).catch(() => toast.error("تعذر تنزيل الملف"))
                        }
                      >
                        <Download className="size-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {quote.responded_at && (
            <Card className="gap-0 border-primary/30 py-0">
              <CardHeader className="border-b py-4!">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Banknote className="size-4 text-primary" />
                  عرض السعر المرسل
                </CardTitle>
              </CardHeader>
              <CardContent className="p-5">
                <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground">التكلفة</p>
                    <p className="mt-1 text-2xl font-bold tracking-tight">
                      {Number(quote.quoted_amount).toLocaleString("ar-EG", {
                        minimumFractionDigits: 2,
                      })}{" "}
                      <span className="text-base text-muted-foreground">{quote.currency}</span>
                    </p>
                  </div>
                  {quote.turnaround_days !== null && (
                    <div>
                      <p className="text-xs text-muted-foreground">مدة التنفيذ</p>
                      <p className="mt-1 text-2xl font-bold tracking-tight">
                        {quote.turnaround_days.toLocaleString("ar-EG")}{" "}
                        <span className="text-base text-muted-foreground">يوم</span>
                      </p>
                    </div>
                  )}
                </div>

                {quote.response_note && (
                  <p className="mt-4 whitespace-pre-wrap rounded-lg bg-muted/50 px-3.5 py-3 text-[13.5px] leading-relaxed">
                    {quote.response_note}
                  </p>
                )}

                <p className="mt-4 text-xs text-muted-foreground">
                  أرسله {quote.responder?.name ?? "—"} في{" "}
                  {dateFormatter.format(new Date(quote.responded_at))}
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-4!">
              <CardTitle className="text-sm">مقدّم الطلب</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-5 text-sm">
              <p className="flex items-center gap-2.5">
                <User className="size-4 shrink-0 text-muted-foreground" />
                <span className="font-medium">{quote.name}</span>
              </p>
              {quote.organization && (
                <p className="flex items-center gap-2.5">
                  <Building2 className="size-4 shrink-0 text-muted-foreground" />
                  {quote.organization}
                </p>
              )}
              <p className="flex items-center gap-2.5">
                <Mail className="size-4 shrink-0 text-muted-foreground" />
                <a href={`mailto:${quote.email}`} dir="ltr" className="hover:text-primary">
                  {quote.email}
                </a>
              </p>
              {quote.phone && (
                <p className="flex items-center gap-2.5">
                  <Phone className="size-4 shrink-0 text-muted-foreground" />
                  <a href={`tel:${quote.phone}`} dir="ltr" className="hover:text-primary">
                    {quote.phone}
                  </a>
                </p>
              )}
              {quote.client && (
                <p className="flex items-center gap-2.5 border-t pt-3">
                  <FolderKanban className="size-4 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">مرتبط بالعميل:</span>
                  {quote.client.name}
                </p>
              )}
              {quote.ip_address && (
                <p className="flex items-center gap-2.5 border-t pt-3 text-xs text-muted-foreground">
                  <MapPin className="size-3.5 shrink-0" />
                  أُرسل من <span dir="ltr">{quote.ip_address}</span>
                </p>
              )}
            </CardContent>
          </Card>

          {manage && !locked && (
            <Card className="gap-0 py-0">
              <CardHeader className="border-b py-4!">
                <CardTitle className="text-sm">إجراءات</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 p-4">
                {quote.status !== "declined" && (
                  <Button
                    variant="outline"
                    className="justify-start"
                    onClick={async () => {
                      if (
                        await confirm({
                          title: "رفض هذا الطلب؟",
                          description:
                            "سيرى العميل على صفحة التتبع أن الطلب تعذّر تنفيذه. لن يُرسل بريد تلقائي.",
                          confirmLabel: "رفض الطلب",
                          destructive: true,
                        })
                      )
                        statusMutation.mutate("declined");
                    }}
                  >
                    <X className="size-4" />
                    رفض الطلب
                  </Button>
                )}
                {quote.status === "declined" && (
                  <Button
                    variant="outline"
                    className="justify-start"
                    onClick={() => statusMutation.mutate("reviewing")}
                  >
                    إعادة فتح الطلب
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="justify-start text-destructive hover:text-destructive"
                  onClick={async () => {
                    if (
                      await confirm({
                        title: `حذف الطلب ${quote.reference}؟`,
                        description:
                          "يختفي الطلب من القائمة ولا يعود العميل قادراً على تتبعه برقمه.",
                        confirmLabel: "حذف",
                        destructive: true,
                      })
                    )
                      deleteMutation.mutate();
                  }}
                >
                  <Trash2 className="size-4" />
                  حذف الطلب
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {manage && (
        <RespondDialog
          key={`respond-${quote.responded_at ?? "new"}`}
          quote={quote}
          open={responding}
          onClose={() => setResponding(false)}
          onSaved={invalidate}
        />
      )}
      {canConvert && (
        <ConvertDialog quote={quote} open={converting} onClose={() => setConverting(false)} />
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-3 px-5 py-3.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end font-medium">{children}</dd>
    </div>
  );
}
