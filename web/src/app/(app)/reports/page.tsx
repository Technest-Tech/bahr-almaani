"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, FileSpreadsheet, FileText, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useFileTransfer } from "@/lib/use-transfer";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/page-header";
import { ToneBadge, type Tone } from "@/components/tone-badge";
import { useAuth } from "@/lib/auth";

type ReportType = "translators" | "productivity" | "daily_words" | "pms" | "monthly" | "projects";

interface ReportData {
  columns: Record<string, string>;
  rows: Record<string, unknown>[];
}

interface ReportExport {
  id: number;
  report_type: ReportType;
  report_label: string;
  format: "xlsx" | "pdf";
  status: "queued" | "processing" | "done" | "failed";
  error: string | null;
  created_at: string;
}

const REPORT_TABS: { value: ReportType; label: string }[] = [
  { value: "translators", label: "إنتاجية المترجمين" },
  { value: "productivity", label: "الإنتاجية مقابل التارجت" },
  { value: "daily_words", label: "الكلمات اليومية" },
  { value: "pms", label: "مديرو المشاريع" },
  { value: "monthly", label: "التقرير الشهري" },
  { value: "projects", label: "سجل المشاريع" },
];

/**
 * The two word-count reports show a system figure next to a self-declared one.
 * Saying so on screen is not decoration: the accountant runs incentives off
 * these numbers, and the gap between the columns has an innocent explanation.
 */
const REPORT_NOTES: Partial<Record<ReportType, string>> = {
  productivity:
    "«كلمات مسلّمة» هي حساب النظام من التسليمات الفعلية، و«كلمات مُعلنة» هي ما سجّله المترجم بنفسه. النظام لا يحتسب أي حوافز أو خصومات.",
  daily_words:
    "كلمات الملف تُقيَّد كاملةً في يوم التسليم، لذا قد يظهر يوم كبير بجوار أيام صفرية لنفس المترجم. الفرق بين العمودين متوقع.",
};

const EXPORT_STATUS: Record<ReportExport["status"], { label: string; tone: Tone }> = {
  queued: { label: "في الانتظار", tone: "slate" },
  processing: { label: "قيد التجهيز", tone: "amber" },
  done: { label: "جاهز", tone: "green" },
  failed: { label: "فشل", tone: "red" },
};

function firstOfMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ReportsPage() {
  const { can } = useAuth();
  const { download } = useFileTransfer();
  const queryClient = useQueryClient();
  const [type, setType] = useState<ReportType>("translators");
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());

  const params = new URLSearchParams({ from, to });

  const { data: report, isLoading } = useQuery({
    queryKey: ["report", type, from, to],
    queryFn: () => api<{ data: ReportData }>(`/reports/${type}?${params.toString()}`).then((r) => r.data),
  });

  const { data: exports } = useQuery({
    queryKey: ["report-exports"],
    queryFn: () => api<{ data: ReportExport[] }>("/reports/exports").then((r) => r.data),
    enabled: can("reports.export"),
  });

  const exportMutation = useMutation({
    mutationFn: (format: "xlsx" | "pdf") =>
      api<{ message: string }>("/reports/export", {
        method: "POST",
        json: { report_type: type, format, params: { from, to } },
      }),
    onSuccess: (response) => {
      toast.success(response.message);
      queryClient.invalidateQueries({ queryKey: ["report-exports"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "تعذر بدء التصدير"),
  });

  const columns = useMemo<ColumnDef<Record<string, unknown>, unknown>[]>(
    () =>
      Object.entries(report?.columns ?? {}).map(([key, label]) => ({
        id: key,
        header: label,
        enableHiding: false,
        cell: ({ row }) => {
          const value = row.original[key];
          if (value === null || value === undefined || value === "") {
            return <span className="text-muted-foreground">—</span>;
          }
          if (typeof value === "number") {
            return <span className="tabular-nums">{value.toLocaleString("ar-EG")}</span>;
          }
          return <span>{String(value)}</span>;
        },
      })),
    [report?.columns],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="التقارير"
        description="تقارير جاهزة بأي مدى زمني — والتصدير Excel أو PDF يعمل في الخلفية ويصلك على الجرس."
      >
        {can("reports.export") && (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={exportMutation.isPending}
              onClick={() => exportMutation.mutate("xlsx")}
            >
              <FileSpreadsheet className="size-4 text-emerald-600" />
              تصدير Excel
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={exportMutation.isPending}
              onClick={() => exportMutation.mutate("pdf")}
            >
              <FileText className="size-4 text-red-500" />
              تصدير PDF
            </Button>
          </>
        )}
      </PageHeader>

      {REPORT_NOTES[type] && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-muted-foreground">{REPORT_NOTES[type]}</p>
        </div>
      )}

      <DataTable
        columns={columns}
        data={report?.rows}
        loading={isLoading}
        emptyTitle="لا توجد بيانات ضمن هذه الفترة"
        emptyDescription="جرّب توسيع المدى الزمني أو اختيار تقرير آخر."
        toolbar={
          <>
            <div className="flex flex-wrap items-center gap-1 rounded-lg bg-background p-1">
              {REPORT_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setType(tab.value)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
                    type === tab.value
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="ms-2 flex items-center gap-2 text-xs text-muted-foreground">
              من
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-8 w-36 bg-background text-[13px]"
              />
              إلى
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-8 w-36 bg-background text-[13px]"
              />
            </div>
          </>
        }
      />

      {can("reports.export") && !!exports?.length && (
        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-4!">
            <CardTitle className="text-sm">تصديراتي الأخيرة</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {exports.map((item) => {
                const status = EXPORT_STATUS[item.status];
                return (
                  <li key={item.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    {item.format === "xlsx" ? (
                      <FileSpreadsheet className="size-4 shrink-0 text-emerald-600" />
                    ) : (
                      <FileText className="size-4 shrink-0 text-red-500" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.report_label}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatRelative(item.created_at)}
                        {item.error && <span className="text-destructive"> — {item.error}</span>}
                      </p>
                    </div>
                    <ToneBadge tone={status.tone}>
                      {(item.status === "queued" || item.status === "processing") && (
                        <Loader2 className="size-3 animate-spin" />
                      )}
                      {status.label}
                    </ToneBadge>
                    {item.status === "done" && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title="تحميل"
                        onClick={() =>
                          download(
                            `/reports/exports/${item.id}/download`,
                            `${item.report_label}.${item.format}`,
                          ).catch(() => toast.error("تعذر تحميل الملف"))
                        }
                      >
                        <Download className="size-4" />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
