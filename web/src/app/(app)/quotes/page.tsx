"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { Building2, Globe, Paperclip, Search, User } from "lucide-react";
import { api } from "@/lib/api";
import {
  PRIORITY_LABELS,
  PRIORITY_TONES,
  QUOTE_STATUS_LABELS,
  QUOTE_STATUS_TONES,
  type Paginated,
  type QuoteRequest,
  type QuoteStatus,
} from "@/lib/types";
import { DataTable, SortableHeader } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { ToneBadge } from "@/components/tone-badge";

const dateFormatter = new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium" });
const ALL = "all";

export default function QuotesPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(ALL);
  const [priority, setPriority] = useState(ALL);
  const [page, setPage] = useState(1);
  const [sorting, setSorting] = useState<SortingState>([]);

  const params = new URLSearchParams({ page: String(page) });
  if (q) params.set("q", q);
  if (status !== ALL) params.set("status", status);
  if (priority !== ALL) params.set("priority", priority);
  if (sorting[0]) {
    params.set("sort", sorting[0].id);
    params.set("dir", sorting[0].desc ? "desc" : "asc");
  }

  const { data, isLoading } = useQuery({
    queryKey: ["quote-requests", q, status, priority, page, sorting],
    queryFn: () => api<Paginated<QuoteRequest>>(`/quote-requests?${params.toString()}`),
  });

  function resetTo(setter: (value: string) => void) {
    return (value: string) => {
      setter(value);
      setPage(1);
    };
  }

  const columns: ColumnDef<QuoteRequest, unknown>[] = [
    {
      accessorKey: "reference",
      enableHiding: false,
      header: ({ column }) => <SortableHeader column={column}>الرقم</SortableHeader>,
      cell: ({ row }) => (
        <span dir="ltr" className="font-mono text-xs font-medium">
          {row.original.reference}
        </span>
      ),
    },
    {
      accessorKey: "name",
      enableHiding: false,
      header: ({ column }) => <SortableHeader column={column}>مقدم الطلب</SortableHeader>,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-medium">
            {row.original.organization ? (
              <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <User className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{row.original.organization ?? row.original.name}</span>
          </p>
          <p className="truncate text-xs text-muted-foreground" dir="ltr">
            {row.original.email}
          </p>
        </div>
      ),
    },
    {
      id: "title",
      meta: { label: "الطلب" },
      header: "الطلب",
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="max-w-64 truncate">{row.original.title}</p>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            {row.original.source_language && row.original.target_language && (
              <span className="inline-flex items-center gap-1">
                <Globe className="size-3" />
                {row.original.source_language.name_ar} ← {row.original.target_language.name_ar}
              </span>
            )}
            {!!row.original.files_count && (
              <span className="inline-flex items-center gap-1">
                <Paperclip className="size-3" />
                {row.original.files_count.toLocaleString("ar-EG")}
              </span>
            )}
          </p>
        </div>
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
        <ToneBadge tone={QUOTE_STATUS_TONES[row.original.status]}>
          {row.original.status_label}
        </ToneBadge>
      ),
    },
    {
      accessorKey: "quoted_amount",
      meta: { label: "العرض" },
      header: ({ column }) => <SortableHeader column={column}>العرض</SortableHeader>,
      cell: ({ row }) =>
        row.original.quoted_amount ? (
          <span className="whitespace-nowrap tabular-nums">
            {Number(row.original.quoted_amount).toLocaleString("ar-EG")} {row.original.currency}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      accessorKey: "created_at",
      meta: { label: "وصل في" },
      header: ({ column }) => <SortableHeader column={column}>وصل في</SortableHeader>,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {dateFormatter.format(new Date(row.original.created_at))}
        </span>
      ),
    },
  ];

  return (
    <div className="w-full space-y-5">
      <PageHeader
        title="طلبات التسعير"
        description="الطلبات الواردة من الموقع الإلكتروني — راجعها، أرسل عرض السعر، ثم حوّلها إلى مشروع."
      />

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
        onRowClick={(row) => router.push(`/quotes/${row.id}`)}
        emptyTitle="لا توجد طلبات تسعير"
        emptyDescription="ستظهر هنا الطلبات التي يرسلها الزوار من الموقع العام."
        totalLabel={(total) => `${total} طلب`}
        toolbar={
          <>
            <div className="relative min-w-52 max-w-xs flex-1">
              <Search className="absolute end-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="بحث برقم الطلب أو الاسم أو البريد…"
                value={q}
                onChange={(event) => {
                  setQ(event.target.value);
                  setPage(1);
                }}
                className="h-8 border-transparent bg-background pe-8 text-[13px] shadow-none focus-visible:border-ring"
              />
            </div>

            <Select value={status} onValueChange={resetTo(setStatus)}>
              <SelectTrigger size="sm" className="w-40 bg-background text-[13px]">
                <SelectValue placeholder="الحالة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>كل الحالات</SelectItem>
                {(Object.keys(QUOTE_STATUS_LABELS) as QuoteStatus[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {QUOTE_STATUS_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={priority} onValueChange={resetTo(setPriority)}>
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
          </>
        }
      />
    </div>
  );
}
