"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  FileWarning,
  FolderKanban,
  Inbox,
  MailOpen,
  Timer,
  Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDuration } from "@/lib/format";
import { PRIORITY_LABELS, PRIORITY_TONES, STATUS_TONES } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { ToneBadge } from "@/components/tone-badge";
import { StatTile } from "@/components/dashboard/stat-tile";
import { ColumnChart, type ColumnDatum } from "@/components/dashboard/column-chart";

interface Summary {
  statuses: Record<string, number>;
  active_total: number;
  late: number;
  due_soon: number;
  completed_this_month: number;
  words_this_month: number;
  pages_this_month: number;
  /** M13 — quote requests from the public site that still need a human. */
  quotes_open: number;
  quotes_new: number;
  clients_total: number;
  translators_active: number;
}

interface Throughput {
  daily: { date: string; completed: number }[];
  weekly: { week_start: string; label: string; completed: number; words: number }[];
}

interface WorkloadRow {
  id: number;
  name: string;
  current: {
    project_id: number;
    code: string;
    title: string;
    priority: keyof typeof PRIORITY_LABELS;
    status: keyof typeof STATUS_TONES;
    deadline_at: string;
    is_late: boolean;
    claimed_at: string | null;
  } | null;
  delivered_this_week: number;
  work_seconds_this_week: number;
}

interface AttentionRow {
  id: number;
  code: string;
  title: string;
  status: keyof typeof STATUS_TONES;
  priority: keyof typeof PRIORITY_LABELS;
  deadline_at: string;
  client: string | null;
  translator: string | null;
  hours: number;
}

const dayFormatter = new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "numeric" });
const fullDayFormatter = new Intl.DateTimeFormat("ar-EG", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

export default function DashboardPage() {
  const { user, can } = useAuth();

  if (!can("dashboard.view")) return <TranslatorHome name={user?.name} />;

  return <ManagerDashboard name={user?.name} />;
}

function ManagerDashboard({ name }: { name?: string }) {
  const { can } = useAuth();
  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: () => api<{ data: Summary }>("/dashboard/summary").then((r) => r.data),
  });

  const { data: throughput } = useQuery({
    queryKey: ["dashboard", "throughput"],
    queryFn: () => api<{ data: Throughput }>("/dashboard/throughput").then((r) => r.data),
  });

  const { data: workload } = useQuery({
    queryKey: ["dashboard", "workload"],
    queryFn: () => api<{ data: WorkloadRow[] }>("/dashboard/workload").then((r) => r.data),
  });

  const { data: attention } = useQuery({
    queryKey: ["dashboard", "late"],
    queryFn: () =>
      api<{ data: { late: AttentionRow[]; due_soon: AttentionRow[] } }>("/dashboard/late").then(
        (r) => r.data,
      ),
  });

  const daily: ColumnDatum[] = (throughput?.daily ?? []).map((d) => ({
    label: dayFormatter.format(new Date(d.date)),
    full: fullDayFormatter.format(new Date(d.date)),
    value: d.completed,
  }));

  const weekly: ColumnDatum[] = (throughput?.weekly ?? []).map((w) => ({
    label: dayFormatter.format(new Date(w.week_start)),
    full: `أسبوع ${dayFormatter.format(new Date(w.week_start))}`,
    value: w.words,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={`أهلاً، ${name?.split(" ")[0] ?? ""} 👋`}
        description="نظرة حية على سير العمل — الأرقام تتحدث لحظياً عبر البث المباشر."
      />

      {/* M13 — the public site's inbox, surfaced only while something is waiting. */}
      {can("quotes.view") && !!summary?.quotes_open && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <MailOpen className="size-5" />
              </div>
              <div>
                <p className="font-semibold">
                  {summary.quotes_open.toLocaleString("ar-EG")} طلب تسعير بانتظار الرد
                </p>
                <p className="text-sm text-muted-foreground">
                  {summary.quotes_new > 0
                    ? `منها ${summary.quotes_new.toLocaleString("ar-EG")} طلب جديد لم يُفتح بعد.`
                    : "كلها قيد الدراسة — لم يُرسل العرض بعد."}
                </p>
              </div>
            </div>
            <Button asChild>
              <Link href="/quotes">
                فتح الطلبات
                <ArrowLeft className="size-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="ملفات في المسار الآن"
          value={summary?.active_total}
          loading={loadingSummary}
          icon={FolderKanban}
          chip="bg-primary/10 text-primary"
          sub={`${(summary?.statuses?.in_review ?? 0).toLocaleString("ar-EG")} بانتظار المراجعة`}
        />
        <StatTile
          label="ملفات متأخرة"
          value={summary?.late}
          loading={loadingSummary}
          icon={FileWarning}
          chip="bg-destructive/10 text-destructive"
        />
        <StatTile
          label="تستحق خلال ٢٤ ساعة"
          value={summary?.due_soon}
          loading={loadingSummary}
          icon={Clock}
          chip="bg-amber-500/10 text-amber-600 dark:text-amber-400"
        />
        <StatTile
          label="مكتملة هذا الشهر"
          value={summary?.completed_this_month}
          loading={loadingSummary}
          icon={CheckCircle2}
          chip="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          sub={`${(summary?.words_this_month ?? 0).toLocaleString("ar-EG")} كلمة مترجمة`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-4!">
            <CardTitle className="text-sm">الملفات المكتملة يومياً — آخر ٣٠ يوماً</CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            {throughput ? (
              <ColumnChart
                title="الملفات المكتملة يومياً"
                data={daily}
                tickEvery={7}
                unit="ملف"
                emptyMessage="لا توجد ملفات مكتملة في آخر ٣٠ يوماً بعد."
              />
            ) : (
              <Skeleton className="h-48" />
            )}
          </CardContent>
        </Card>

        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-4!">
            <CardTitle className="text-sm">الكلمات المترجمة أسبوعياً — آخر ١٢ أسبوعاً</CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            {throughput ? (
              <ColumnChart
                title="الكلمات المترجمة أسبوعياً"
                data={weekly}
                tickEvery={2}
                unit="كلمة"
                emptyMessage="لا توجد كلمات مكتملة في آخر ١٢ أسبوعاً بعد."
              />
            ) : (
              <Skeleton className="h-48" />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Card className="gap-0 py-0 xl:col-span-3">
          <CardHeader className="border-b py-4!">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Users className="size-4 text-primary" />
              فريق الترجمة الآن
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!workload ? (
              <div className="space-y-2 p-5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : workload.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                لا يوجد مترجمون نشطون بعد.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="px-5 py-2.5 text-start font-medium">المترجم</th>
                    <th className="px-3 py-2.5 text-start font-medium">الملف الحالي</th>
                    <th className="px-3 py-2.5 text-start font-medium">تسليمات الأسبوع</th>
                    <th className="px-5 py-2.5 text-start font-medium">ساعات الأسبوع</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {workload.map((row) => (
                    <tr key={row.id}>
                      <td className="px-5 py-3 font-medium">{row.name}</td>
                      <td className="px-3 py-3">
                        {row.current ? (
                          <Link
                            href={`/projects/${row.current.project_id}`}
                            className="group inline-flex flex-wrap items-center gap-2"
                          >
                            <span className="max-w-48 truncate group-hover:underline">
                              {row.current.title}
                            </span>
                            <ToneBadge tone={PRIORITY_TONES[row.current.priority]}>
                              {PRIORITY_LABELS[row.current.priority]}
                            </ToneBadge>
                            {row.current.is_late && (
                              <ToneBadge tone="red">
                                <AlertTriangle className="size-3" />
                                متأخر
                              </ToneBadge>
                            )}
                          </Link>
                        ) : (
                          <ToneBadge tone="slate">متفرغ</ToneBadge>
                        )}
                      </td>
                      <td className="px-3 py-3 tabular-nums">
                        {row.delivered_this_week.toLocaleString("ar-EG")}
                      </td>
                      <td className="px-5 py-3">
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Timer className="size-3.5" />
                          {formatDuration(row.work_seconds_this_week)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card className="gap-0 py-0 xl:col-span-2">
          <CardHeader className="border-b py-4!">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="size-4 text-destructive" />
              تحتاج انتباهك
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!attention ? (
              <div className="space-y-2 p-5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : attention.late.length === 0 && attention.due_soon.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                كل شيء تحت السيطرة — لا ملفات متأخرة أو مستحقة قريباً 🎉
              </p>
            ) : (
              <ul className="divide-y">
                {attention.late.map((row) => (
                  <AttentionItem key={row.id} row={row} late />
                ))}
                {attention.due_soon.map((row) => (
                  <AttentionItem key={row.id} row={row} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AttentionItem({ row, late = false }: { row: AttentionRow; late?: boolean }) {
  return (
    <li>
      <Link
        href={`/projects/${row.id}`}
        className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-accent"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{row.title}</p>
          <p className="text-xs text-muted-foreground">
            <span dir="ltr" className="font-mono">{row.code}</span>
            {row.translator && <> · {row.translator}</>}
          </p>
        </div>
        <ToneBadge tone={late ? "red" : "amber"}>
          {late
            ? `متأخر ${row.hours.toLocaleString("ar-EG")} ساعة`
            : `خلال ${row.hours.toLocaleString("ar-EG")} ساعة`}
        </ToneBadge>
      </Link>
    </li>
  );
}

/** Translators land here without dashboard access — greet and route to the portal. */
function TranslatorHome({ name }: { name?: string }) {
  return (
    <div className="space-y-6">
      <PageHeader
        title={`أهلاً، ${name?.split(" ")[0] ?? ""} 👋`}
        description="ملفاتك تصلك لحظياً — افتح البورتال لاستلام أعمال جديدة."
      />
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-6">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Inbox className="size-5" />
            </div>
            <div>
              <p className="font-semibold">بورتال المترجم</p>
              <p className="text-sm text-muted-foreground">
                قائمة الملفات المتاحة لأزواج لغاتك، مرتبة حسب الأولوية.
              </p>
            </div>
          </div>
          <Button asChild>
            <Link href="/portal">
              فتح البورتال
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
