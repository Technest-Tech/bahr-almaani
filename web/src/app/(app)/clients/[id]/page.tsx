"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import {
  ArrowRight,
  Building2,
  CalendarClock,
  Download,
  FileText,
  Globe,
  KeyRound,
  Mail,
  Pencil,
  MessageSquareQuote,
  Phone,
  Receipt,
  ShieldOff,
  StickyNote,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { api, downloadFile } from "@/lib/api";
import {
  CLIENT_STAGE_TONES,
  QUOTE_STATUS_TONES,
  STATUS_LABELS,
  STATUS_TONES,
  type AdminClientOverview,
  type ProjectStatus,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { ToneBadge } from "@/components/tone-badge";
import { useConfirm } from "@/components/confirm";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";

const dateFormatter = new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium" });

const dateTimeFormatter = new Intl.DateTimeFormat("ar-EG", {
  dateStyle: "medium",
  timeStyle: "short",
});

const numberFormatter = new Intl.NumberFormat("ar-EG");

export default function ClientFilePage() {
  const id = useParams<{ id: string }>().id;
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const [busy, setBusy] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["client-file", id],
    queryFn: () => api<AdminClientOverview>(`/clients/${id}/overview`),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["client-file", id] });
    queryClient.invalidateQueries({ queryKey: ["clients"] });
  };

  const revokeMutation = useMutation({
    mutationFn: () => api(`/clients/${id}/account`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast.success("أُلغي حساب العميل على الموقع");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "حدث خطأ"),
  });

  if (isLoading || !data) {
    return (
      <div className="w-full space-y-5">
        <Skeleton className="h-16 w-72 rounded-xl" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const { client, stats, projects, invoices, quote_requests: quotes } = data;

  async function downloadInvoice(invoiceId: number, number: string) {
    setBusy(invoiceId);
    try {
      await downloadFile(`/invoices/${invoiceId}/download`, `${number}.pdf`);
    } catch {
      toast.error("تعذر تحميل الفاتورة");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="w-full space-y-5">
      <Button variant="ghost" size="sm" asChild className="-ms-2">
        <Link href="/clients">
          <ArrowRight className="size-4" />
          كل العملاء
        </Link>
      </Button>

      <PageHeader
        title={client.name}
        description={client.type === "company" ? "عميل شركة" : "عميل فرد"}
      >
        <ToneBadge tone={client.type === "company" ? "blue" : "slate"}>
          {client.type === "company" ? "شركة" : "فرد"}
        </ToneBadge>
        {client.has_account && (
          <ToneBadge tone={client.status === "suspended" ? "red" : "green"}>
            {client.status === "suspended" ? "حساب موقوف" : "حساب مُفعّل"}
          </ToneBadge>
        )}
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          <Pencil className="size-4" />
          تعديل
        </Button>
      </PageHeader>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="المشاريع"
          value={numberFormatter.format(client.projects_count ?? 0)}
          hint={
            stats.uninvoiced_projects > 0
              ? `${numberFormatter.format(stats.uninvoiced_projects)} منجزة بلا فاتورة`
              : "لا يوجد عمل منجز بلا فاتورة"
          }
        />
        {/* Pages first — the delivered basis, the same one the invoices bill on. */}
        <Stat
          label="إجمالي الصفحات"
          value={numberFormatter.format(stats.total_pages)}
          hint={`${numberFormatter.format(stats.total_words)} كلمة`}
        />
        <Stat
          label="الفواتير"
          value={numberFormatter.format(client.invoices_count ?? 0)}
          hint={stats.billing
            .map(
              (row) =>
                `${Number(row.amount).toLocaleString("ar-EG", {
                  minimumFractionDigits: 2,
                })} ${row.currency}`,
            )
            .join(" · ")}
        />
        <Stat
          label="آخر تسليم"
          value={
            stats.last_delivery_at ? (
              <span className="text-lg">
                {dateFormatter.format(new Date(stats.last_delivery_at))}
              </span>
            ) : (
              "—"
            )
          }
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <Panel title="المشاريع" icon={FileText} empty="لا توجد مشاريع لهذا العميل بعد.">
            {projects.length > 0 && (
              <ul className="divide-y">
                {projects.map((project) => (
                  <li key={project.id}>
                    <Link
                      href={`/projects/${project.id}`}
                      className="flex flex-wrap items-center gap-3 px-5 py-3 transition-colors hover:bg-accent/50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-[11.5px] text-muted-foreground" dir="ltr">
                          {project.code}
                        </p>
                        <p className="mt-0.5 truncate text-[13.5px] font-medium">
                          {project.title}
                        </p>
                      </div>
                      <div className="text-end text-[12.5px] text-muted-foreground">
                        {project.pages !== null && (
                          <p className="tabular-nums">
                            {numberFormatter.format(project.pages)} صفحة
                          </p>
                        )}
                        {project.invoice_number && (
                          <p className="font-mono text-[11px]" dir="ltr">
                            {project.invoice_number}
                          </p>
                        )}
                      </div>
                      <ToneBadge tone={CLIENT_STAGE_TONES[project.stage]}>
                        {project.stage_label}
                      </ToneBadge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="الفواتير" icon={Receipt} empty="لم تصدر فواتير لهذا العميل.">
            {invoices.length > 0 && (
              <ul className="divide-y">
                {invoices.map((invoice) => (
                  <li
                    key={invoice.id}
                    className="flex flex-wrap items-center gap-3 px-5 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[13px] font-semibold" dir="ltr">
                        {invoice.number}
                      </p>
                      <p className="mt-0.5 text-[12px] text-muted-foreground">
                        {dateFormatter.format(new Date(invoice.issued_at))} ·{" "}
                        {numberFormatter.format(invoice.total_pages)} صفحة
                      </p>
                    </div>
                    <p className="font-semibold tabular-nums">
                      {Number(invoice.amount).toLocaleString("ar-EG", {
                        minimumFractionDigits: 2,
                      })}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        {invoice.currency}
                      </span>
                    </p>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="تحميل الفاتورة"
                      loading={busy === invoice.id}
                      onClick={() => downloadInvoice(invoice.id, invoice.number)}
                    >
                      <Download className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="طلبات عروض الأسعار"
            icon={MessageSquareQuote}
            empty="لا توجد طلبات عروض مرتبطة بهذا العميل."
          >
            {quotes.length > 0 && (
              <ul className="divide-y">
                {quotes.map((quote) => (
                  <li key={quote.id}>
                    <Link
                      href={`/quotes/${quote.id}`}
                      className="flex flex-wrap items-center gap-3 px-5 py-3 transition-colors hover:bg-accent/50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-[11.5px] text-muted-foreground" dir="ltr">
                          {quote.reference}
                        </p>
                        <p className="mt-0.5 truncate text-[13.5px] font-medium">
                          {quote.title}
                        </p>
                      </div>
                      <span className="text-[12px] text-muted-foreground">
                        {dateFormatter.format(new Date(quote.created_at))}
                      </span>
                      <ToneBadge tone={QUOTE_STATUS_TONES[quote.status]}>
                        {quote.status_label}
                      </ToneBadge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          <Card>
            <CardContent className="space-y-3.5">
              <h2 className="text-sm font-semibold">بيانات التواصل</h2>
              <Detail icon={UserRound} label="الاسم">
                {client.name}
              </Detail>
              <Detail icon={client.type === "company" ? Building2 : UserRound} label="النوع">
                {client.type === "company" ? "شركة" : "فرد"}
              </Detail>
              <Detail icon={Phone} label="الهاتف">
                <span dir="ltr">{client.phone ?? "—"}</span>
              </Detail>
              <Detail icon={Mail} label="البريد">
                <span dir="ltr">{client.email ?? "—"}</span>
              </Detail>
              <Detail icon={CalendarClock} label="أضيف في">
                {dateFormatter.format(new Date(client.created_at))}
              </Detail>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3.5">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <KeyRound className="size-4 text-muted-foreground" />
                حساب الموقع
              </h2>

              {client.has_account ? (
                <>
                  <Detail icon={Globe} label="الحالة">
                    <ToneBadge tone={client.status === "suspended" ? "red" : "green"}>
                      {client.status === "suspended" ? "موقوف" : "مُفعّل"}
                    </ToneBadge>
                  </Detail>
                  <Detail icon={CalendarClock} label="آخر دخول">
                    {client.last_login_at
                      ? dateTimeFormatter.format(new Date(client.last_login_at))
                      : "لم يدخل بعد"}
                  </Detail>
                  <Detail icon={UserRound} label="مصدر الحساب">
                    {client.self_registered ? "سجّل بنفسه من الموقع" : "فتحه المكتب"}
                  </Detail>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    loading={revokeMutation.isPending}
                    onClick={async () => {
                      if (
                        await confirm({
                          title: `إلغاء حساب «${client.name}» على الموقع؟`,
                          description:
                            "يفقد العميل إمكانية الدخول، ويبقى سجله ومشاريعه كما هي. يمكن إعادة تفعيله بكلمة مرور جديدة.",
                          confirmLabel: "إلغاء الحساب",
                          destructive: true,
                        })
                      )
                        revokeMutation.mutate();
                    }}
                  >
                    <ShieldOff className="size-4" />
                    إلغاء حساب الموقع
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    لا يملك هذا العميل حساباً على الموقع. افتح له حساباً بتعيين كلمة مرور، فتظهر
                    له كل مشاريعه وفواتيره السابقة فور دخوله.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setEditing(true)}
                  >
                    <KeyRound className="size-4" />
                    فتح حساب للعميل
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          {client.notes && (
            <Card>
              <CardContent className="space-y-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <StickyNote className="size-4 text-muted-foreground" />
                  ملاحظات داخلية
                </h2>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
                  {client.notes}
                </p>
              </CardContent>
            </Card>
          )}

          {Object.keys(stats.by_status).length > 0 && (
            <Card>
              <CardContent className="space-y-2.5">
                <h2 className="text-sm font-semibold">المشاريع حسب الحالة</h2>
                <ul className="space-y-1.5 text-[13px]">
                  {Object.entries(stats.by_status).map(([status, total]) => (
                    <li key={status} className="flex items-center justify-between gap-2">
                      <ToneBadge tone={STATUS_TONES[status as ProjectStatus]}>
                        {STATUS_LABELS[status as ProjectStatus]}
                      </ToneBadge>
                      <span className="tabular-nums">{numberFormatter.format(total)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <ClientFormDialog
        key={editing ? `edit-${client.id}` : "closed"}
        client={client}
        open={editing}
        onClose={() => setEditing(false)}
        onSaved={invalidate}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3.5">
      <p className="text-[12.5px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Panel({
  title,
  icon: Icon,
  empty,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden py-0">
      <CardContent className="p-0">
        <div className="flex items-center gap-2 border-b px-5 py-3.5">
          <Icon className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">{title}</h2>
        </div>
        {/* Callers pass `list.length > 0 && <ul>` — a `false` here means empty. */}
        {children || (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">{empty}</p>
        )}
      </CardContent>
    </Card>
  );
}

function Detail({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <span className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </span>
      <span className="text-end font-medium">{children}</span>
    </div>
  );
}
