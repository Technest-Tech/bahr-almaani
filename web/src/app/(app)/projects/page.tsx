"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { AlertTriangle, Globe, IdCard, Plus, Search } from "lucide-react";
import { api } from "@/lib/api";
import {
  PRIORITY_LABELS,
  PRIORITY_TONES,
  STATUS_TONES,
  type Paginated,
  type Project,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { DataTable, SortableHeader } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/page-header";
import { ToneBadge } from "@/components/tone-badge";
import { useAuth } from "@/lib/auth";
import { officeFormat } from "@/lib/format";

const dateFormatter = officeFormat({
  dateStyle: "medium",
  timeStyle: "short",
});

const ALL = "__all__";

const STATUS_OPTIONS = [
  ["draft", "مسودة"],
  ["available", "متاح"],
  ["claimed", "قيد التنفيذ"],
  ["delivered", "تم التسليم"],
  ["in_review", "قيد المراجعة"],
  ["revision_requested", "مطلوب تعديل"],
  ["approved", "معتمد"],
  ["completed", "مكتمل"],
  ["cancelled", "ملغي"],
] as const;

/** Owner filter value for a client's submission no PM has taken yet. */
const UNOWNED = "none";

interface Person {
  id: number;
  name: string;
}

export default function ProjectsPage() {
  const { can } = useAuth();
  const router = useRouter();
  // The admin's view: every PM's projects, so "whose is it, who is on it" is worth
  // a column and a filter. A PM's list is all their own — nothing to tell apart.
  const seesAll = can("projects.view-all");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(ALL);
  const [priority, setPriority] = useState(ALL);
  const [manager, setManager] = useState(ALL);
  const [translator, setTranslator] = useState(ALL);
  const [lateOnly, setLateOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [sorting, setSorting] = useState<SortingState>([]);

  const params = new URLSearchParams({ page: String(page) });
  if (q) params.set("q", q);
  if (status !== ALL) params.set("status", status);
  if (priority !== ALL) params.set("priority", priority);
  if (manager !== ALL) params.set("created_by", manager);
  if (translator !== ALL) params.set("translator_id", translator);
  if (lateOnly) params.set("late", "1");
  if (sorting[0]) {
    params.set("sort", sorting[0].id);
    params.set("dir", sorting[0].desc ? "desc" : "asc");
  }

  const { data, isLoading } = useQuery({
    queryKey: ["projects", q, status, priority, manager, translator, lateOnly, page, sorting],
    queryFn: () => api<Paginated<Project>>(`/projects?${params.toString()}`),
  });

  const { data: people } = useQuery({
    queryKey: ["project-filter-options"],
    queryFn: () =>
      api<{ data: { managers: Person[]; translators: Person[] } }>("/projects/filter-options").then(
        (r) => r.data,
      ),
    enabled: seesAll,
  });

  const peopleColumns: ColumnDef<Project, unknown>[] = [
    {
      id: "manager",
      meta: { label: "مدير المشروع" },
      header: "مدير المشروع",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.creator?.name ?? (row.original.client_submitted ? "لم يُستلم بعد" : "—")}
        </span>
      ),
    },
    {
      id: "translator",
      meta: { label: "المترجم" },
      header: "المترجم",
      // A withdrawn translator is no longer on the job — the file is back on the portal.
      cell: ({ row }) => {
        const assignment = row.original.assignment;
        return (
          <span className="text-muted-foreground">
            {assignment && assignment.status !== "withdrawn"
              ? (assignment.translator?.name ?? "—")
              : "—"}
          </span>
        );
      },
    },
  ];

  const columns: ColumnDef<Project, unknown>[] = [
    {
      accessorKey: "title",
      enableHiding: false,
      header: ({ column }) => <SortableHeader column={column}>المشروع</SortableHeader>,
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.title}</p>
          <p dir="ltr" className="text-start font-mono text-xs text-muted-foreground">
            {row.original.code}
          </p>
        </div>
      ),
    },
    {
      id: "client",
      meta: { label: "العميل" },
      header: "العميل",
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.client?.name ?? "—"}</span>
      ),
    },
    ...(seesAll ? peopleColumns : []),
    {
      id: "languages",
      meta: { label: "اللغات" },
      header: "اللغات",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.source_language?.name_ar} ← {row.original.target_language?.name_ar}
        </span>
      ),
    },
    {
      accessorKey: "priority",
      meta: { label: "الأولوية" },
      header: ({ column }) => <SortableHeader column={column}>الأولوية</SortableHeader>,
      cell: ({ row }) => (
        <ToneBadge tone={PRIORITY_TONES[row.original.priority]}>
          {PRIORITY_LABELS[row.original.priority]}
        </ToneBadge>
      ),
    },
    {
      accessorKey: "status",
      meta: { label: "الحالة" },
      header: ({ column }) => <SortableHeader column={column}>الحالة</SortableHeader>,
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <ToneBadge tone={STATUS_TONES[row.original.status]}>
            {row.original.status_label}
          </ToneBadge>
          {/* A draft the client sent from their own account: nobody in the office
              has checked its date, letterhead or stamp yet. */}
          {row.original.client_submitted && row.original.status === "draft" && (
            <ToneBadge tone="blue" title="أضافه العميل من حسابه — بانتظار المراجعة والنشر">
              <Globe />
              من العميل
            </ToneBadge>
          )}
          {/* Beside the status rather than inside it: the project is still
              claimed, it is just blocked on something only the client can send. */}
          {row.original.awaiting_documents && (
            <ToneBadge tone="amber" title="بانتظار مستند من العميل">
              <IdCard />
              مستند مطلوب
            </ToneBadge>
          )}
        </div>
      ),
    },
    {
      // Delivered once counted, source until then — same rule as the reports.
      // Pages lead: certified work is priced per page.
      accessorKey: "total_pages",
      meta: { label: "صفحات / كلمات" },
      header: ({ column }) => <SortableHeader column={column}>صفحات / كلمات</SortableHeader>,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {(row.original.delivered_pages ?? row.original.total_pages)?.toLocaleString("ar-EG") ?? "—"} /{" "}
          {(row.original.delivered_words ?? row.original.total_words)?.toLocaleString("ar-EG") ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "deadline_at",
      meta: { label: "موعد التسليم" },
      header: ({ column }) => <SortableHeader column={column}>موعد التسليم</SortableHeader>,
      cell: ({ row }) => (
        <span
          className={`inline-flex items-center gap-1.5 text-xs ${
            row.original.is_late ? "font-medium text-destructive" : "text-muted-foreground"
          }`}
        >
          {row.original.is_late && <AlertTriangle className="size-3.5" />}
          {dateFormatter.format(new Date(row.original.deadline_at))}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="المشاريع" description="رحلة الملف من الاستلام إلى التسليم">
        {can("projects.manage") && (
          <Button asChild>
            <Link href="/projects/new">
              <Plus className="size-4" />
              مشروع جديد
            </Link>
          </Button>
        )}
      </PageHeader>

      <DataTable
        columns={columns}
        data={data?.data}
        loading={isLoading}
        meta={data?.meta}
        onPageChange={setPage}
        sorting={sorting}
        onSortingChange={(next) => {
          setSorting(next);
          setPage(1);
        }}
        onRowClick={(project) => router.push(`/projects/${project.id}`)}
        emptyTitle="لا توجد مشاريع مطابقة"
        emptyDescription="جرّب تعديل الفلاتر أو أنشئ مشروعاً جديداً."
        totalLabel={(total) => `${total} مشروع`}
        toolbar={
          <>
            <div className="relative min-w-56 flex-1">
              <Search className="absolute end-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="بحث بالعنوان أو الكود…"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
                className="h-8 border-transparent bg-background pe-8 text-[13px] shadow-none focus-visible:border-ring"
              />
            </div>
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
              <SelectTrigger size="sm" className="w-40 bg-background text-[13px]">
                <SelectValue placeholder="الحالة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>كل الحالات</SelectItem>
                {STATUS_OPTIONS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={priority} onValueChange={(v) => { setPriority(v); setPage(1); }}>
              <SelectTrigger size="sm" className="w-32 bg-background text-[13px]">
                <SelectValue placeholder="الأولوية" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>كل الأولويات</SelectItem>
                <SelectItem value="normal">عادي</SelectItem>
                <SelectItem value="urgent">عاجل</SelectItem>
                <SelectItem value="critical">حرج</SelectItem>
              </SelectContent>
            </Select>
            {seesAll && (
              <>
                <Select value={manager} onValueChange={(v) => { setManager(v); setPage(1); }}>
                  <SelectTrigger size="sm" className="w-40 bg-background text-[13px]">
                    <SelectValue placeholder="مدير المشروع" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>كل مديري المشاريع</SelectItem>
                    <SelectItem value={UNOWNED}>لم يُستلم بعد</SelectItem>
                    {people?.managers.map((person) => (
                      <SelectItem key={person.id} value={String(person.id)}>
                        {person.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={translator} onValueChange={(v) => { setTranslator(v); setPage(1); }}>
                  <SelectTrigger size="sm" className="w-40 bg-background text-[13px]">
                    <SelectValue placeholder="المترجم" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>كل المترجمين</SelectItem>
                    {people?.translators.map((person) => (
                      <SelectItem key={person.id} value={String(person.id)}>
                        {person.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
            <div className="flex items-center gap-2 ps-1">
              <Switch
                id="late-only"
                checked={lateOnly}
                onCheckedChange={(checked) => {
                  setLateOnly(checked);
                  setPage(1);
                }}
              />
              <Label htmlFor="late-only" className="cursor-pointer text-[13px] font-normal">
                المتأخرة فقط
              </Label>
            </div>
          </>
        }
      />
    </div>
  );
}
