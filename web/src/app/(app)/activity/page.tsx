"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { api } from "@/lib/api";
import { formatRelative, dateTimeFormatter } from "@/lib/format";
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  type Paginated,
  type Priority,
  type ProjectStatus,
} from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/page-header";
import { ToneBadge, type Tone } from "@/components/tone-badge";

interface ActivityRow {
  id: number;
  log_name: "projects" | "clients" | "users" | string;
  event: "created" | "updated" | "deleted" | "restored" | string;
  causer: { id: number; name: string } | null;
  subject_type: string;
  subject_id: number | null;
  subject_label: string | null;
  changes: {
    attributes: Record<string, unknown>;
    old: Record<string, unknown>;
  };
  created_at: string;
}

const ALL = "__all__";

const LOG_LABELS: Record<string, string> = {
  projects: "المشاريع",
  clients: "العملاء",
  users: "المستخدمون",
};

const EVENT_META: Record<string, { label: string; tone: Tone }> = {
  created: { label: "إنشاء", tone: "green" },
  updated: { label: "تعديل", tone: "blue" },
  deleted: { label: "حذف", tone: "red" },
  restored: { label: "استرجاع", tone: "teal" },
};

/** Arabic labels for the fields the models actually log. */
const FIELD_LABELS: Record<string, string> = {
  title: "العنوان",
  status: "الحالة",
  priority: "الأولوية",
  deadline_at: "موعد التسليم",
  client_id: "العميل",
  quoted_amount: "المبلغ",
  name: "الاسم",
  email: "البريد",
  phone: "الهاتف",
  type: "النوع",
  locale: "اللغة",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "نعم" : "لا";
  if (key === "status" && typeof value === "string" && value in STATUS_LABELS) {
    return STATUS_LABELS[value as ProjectStatus];
  }
  if (key === "priority" && typeof value === "string" && value in PRIORITY_LABELS) {
    return PRIORITY_LABELS[value as Priority];
  }
  if (typeof value === "string" && ISO_DATE.test(value)) {
    return dateTimeFormatter.format(new Date(value));
  }
  return String(value);
}

export default function ActivityPage() {
  const [log, setLog] = useState(ALL);
  const [event, setEvent] = useState(ALL);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ActivityRow | null>(null);

  const params = new URLSearchParams({ page: String(page) });
  if (log !== ALL) params.set("log", log);
  if (event !== ALL) params.set("event", event);

  const { data, isLoading } = useQuery({
    queryKey: ["activity-log", log, event, page],
    queryFn: () => api<Paginated<ActivityRow>>(`/activity-log?${params.toString()}`),
  });

  const columns: ColumnDef<ActivityRow, unknown>[] = [
    {
      id: "event",
      enableHiding: false,
      header: "النشاط",
      cell: ({ row }) => {
        const meta = EVENT_META[row.original.event] ?? {
          label: row.original.event,
          tone: "slate" as Tone,
        };
        return (
          <div className="flex items-center gap-2">
            <ToneBadge tone={meta.tone}>{meta.label}</ToneBadge>
            <span className="text-xs text-muted-foreground">
              {LOG_LABELS[row.original.log_name] ?? row.original.log_name}
            </span>
          </div>
        );
      },
    },
    {
      id: "subject",
      enableHiding: false,
      header: "السجل",
      cell: ({ row }) => (
        <p className="max-w-72 truncate font-medium">
          {row.original.subject_label ?? `${row.original.subject_type} #${row.original.subject_id ?? "؟"}`}
        </p>
      ),
    },
    {
      id: "causer",
      meta: { label: "بواسطة" },
      header: "بواسطة",
      cell: ({ row }) => (
        <span className="text-sm">{row.original.causer?.name ?? "النظام"}</span>
      ),
    },
    {
      id: "changes",
      meta: { label: "التغييرات" },
      header: "التغييرات",
      cell: ({ row }) => {
        const keys = Object.keys(row.original.changes.attributes);
        if (keys.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <span className="text-xs text-muted-foreground">
            {keys
              .slice(0, 3)
              .map((key) => FIELD_LABELS[key] ?? key)
              .join("، ")}
            {keys.length > 3 && ` +${(keys.length - 3).toLocaleString("ar-EG")}`}
          </span>
        );
      },
    },
    {
      id: "created_at",
      meta: { label: "التاريخ" },
      header: "التاريخ",
      cell: ({ row }) => (
        <span
          className="whitespace-nowrap text-xs text-muted-foreground"
          title={dateTimeFormatter.format(new Date(row.original.created_at))}
        >
          {formatRelative(row.original.created_at)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="سجل النشاط"
        description="سجل تدقيق كامل لكل ما يحدث في النظام — من فعل ماذا ومتى. للقراءة فقط."
      />

      <DataTable
        columns={columns}
        data={data?.data}
        loading={isLoading}
        meta={data?.meta}
        onPageChange={setPage}
        emptyTitle="لا توجد أنشطة مسجلة"
        emptyDescription="ستظهر هنا كل التغييرات على المشاريع والعملاء والمستخدمين."
        totalLabel={(total) => `${total.toLocaleString("ar-EG")} نشاط`}
        onRowClick={(row) => setSelected(row)}
        toolbar={
          <>
            <Select value={log} onValueChange={(v) => { setLog(v); setPage(1); }}>
              <SelectTrigger size="sm" className="w-36 bg-background text-[13px]">
                <SelectValue placeholder="السجل" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>كل السجلات</SelectItem>
                {Object.entries(LOG_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={event} onValueChange={(v) => { setEvent(v); setPage(1); }}>
              <SelectTrigger size="sm" className="w-32 bg-background text-[13px]">
                <SelectValue placeholder="النشاط" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>كل الأنشطة</SelectItem>
                {Object.entries(EVENT_META).map(([value, meta]) => (
                  <SelectItem key={value} value={value}>
                    {meta.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      />

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-lg">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
                  {(() => {
                    const meta = EVENT_META[selected.event] ?? {
                      label: selected.event,
                      tone: "slate" as Tone,
                    };
                    return <ToneBadge tone={meta.tone}>{meta.label}</ToneBadge>;
                  })()}
                  <span className="truncate">
                    {selected.subject_label ?? `${selected.subject_type} #${selected.subject_id ?? "؟"}`}
                  </span>
                </DialogTitle>
              </DialogHeader>

              <p className="text-xs text-muted-foreground">
                بواسطة {selected.causer?.name ?? "النظام"} —{" "}
                {dateTimeFormatter.format(new Date(selected.created_at))}
              </p>

              {Object.keys(selected.changes.attributes).length > 0 ? (
                <div className="overflow-hidden rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
                        <th className="px-3 py-2 text-start font-medium">الحقل</th>
                        {selected.event === "updated" && (
                          <th className="px-3 py-2 text-start font-medium">قبل</th>
                        )}
                        <th className="px-3 py-2 text-start font-medium">
                          {selected.event === "updated" ? "بعد" : "القيمة"}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {Object.entries(selected.changes.attributes).map(([key, value]) => (
                        <tr key={key}>
                          <td className="px-3 py-2 text-xs font-medium text-muted-foreground">
                            {FIELD_LABELS[key] ?? key}
                          </td>
                          {selected.event === "updated" && (
                            <td className="px-3 py-2 text-xs">
                              {formatValue(key, selected.changes.old[key])}
                            </td>
                          )}
                          <td className="px-3 py-2 text-xs font-medium">
                            {formatValue(key, value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">لا توجد تفاصيل تغييرات لهذا النشاط.</p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
