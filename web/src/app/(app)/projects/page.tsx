"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Plus, Search } from "lucide-react";
import { api } from "@/lib/api";
import {
  PRIORITY_LABELS,
  PRIORITY_TONES,
  STATUS_TONES,
  type Paginated,
  type Project,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
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
import { ToneBadge } from "@/components/tone-badge";
import { useAuth } from "@/lib/auth";

const dateFormatter = new Intl.DateTimeFormat("ar-EG", {
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

export default function ProjectsPage() {
  const { can } = useAuth();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(ALL);
  const [priority, setPriority] = useState(ALL);
  const [lateOnly, setLateOnly] = useState(false);
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page) });
  if (q) params.set("q", q);
  if (status !== ALL) params.set("status", status);
  if (priority !== ALL) params.set("priority", priority);
  if (lateOnly) params.set("late", "1");

  const { data, isLoading } = useQuery({
    queryKey: ["projects", q, status, priority, lateOnly, page],
    queryFn: () => api<Paginated<Project>>(`/projects?${params.toString()}`),
  });

  const columns: ColumnDef<Project, unknown>[] = [
    {
      accessorKey: "title",
      header: "المشروع",
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
      header: "العميل",
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.client?.name ?? "—"}</span>
      ),
    },
    {
      id: "languages",
      header: "اللغات",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.source_language?.name_ar} ← {row.original.target_language?.name_ar}
        </span>
      ),
    },
    {
      accessorKey: "priority",
      header: "الأولوية",
      cell: ({ row }) => (
        <ToneBadge tone={PRIORITY_TONES[row.original.priority]}>
          {PRIORITY_LABELS[row.original.priority]}
        </ToneBadge>
      ),
    },
    {
      accessorKey: "status",
      header: "الحالة",
      cell: ({ row }) => (
        <ToneBadge tone={STATUS_TONES[row.original.status]}>
          {row.original.status_label}
        </ToneBadge>
      ),
    },
    {
      id: "counts",
      header: "كلمات / صفحات",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.total_words?.toLocaleString("ar-EG") ?? "—"} /{" "}
          {row.original.total_pages?.toLocaleString("ar-EG") ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "deadline_at",
      header: "موعد التسليم",
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">المشاريع</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            رحلة الملف من الاستلام إلى التسليم
          </p>
        </div>
        {can("projects.manage") && (
          <Button asChild>
            <Link href="/projects/new">
              <Plus className="size-4" />
              مشروع جديد
            </Link>
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-60 flex-1">
          <Search className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="بحث بالعنوان أو الكود…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            className="pe-9"
          />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-44">
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
          <SelectTrigger className="w-36">
            <SelectValue placeholder="الأولوية" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>كل الأولويات</SelectItem>
            <SelectItem value="normal">عادي</SelectItem>
            <SelectItem value="urgent">عاجل</SelectItem>
            <SelectItem value="critical">حرج</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Switch
            id="late-only"
            checked={lateOnly}
            onCheckedChange={(checked) => {
              setLateOnly(checked);
              setPage(1);
            }}
          />
          <Label htmlFor="late-only" className="cursor-pointer text-sm font-normal">
            المتأخرة فقط
          </Label>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={data?.data}
        loading={isLoading}
        meta={data?.meta}
        onPageChange={setPage}
        onRowClick={(project) => router.push(`/projects/${project.id}`)}
        emptyTitle="لا توجد مشاريع مطابقة"
        emptyDescription="جرّب تعديل الفلاتر أو أنشئ مشروعاً جديداً."
        totalLabel={(total) => `${total} مشروع`}
      />
    </div>
  );
}
