"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import {
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  ShieldOff,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Client, Paginated } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { DataTable, SortableHeader } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { ToneBadge } from "@/components/tone-badge";
import { useConfirm } from "@/components/confirm";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";

const dateFormatter = new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium" });

export default function ClientsPage() {
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [editing, setEditing] = useState<Client | null | "new">(null);

  const params = new URLSearchParams({ page: String(page) });
  if (q) params.set("q", q);
  if (sorting[0]) {
    params.set("sort", sorting[0].id);
    params.set("dir", sorting[0].desc ? "desc" : "asc");
  }

  const { data, isLoading } = useQuery({
    queryKey: ["clients", q, page, sorting],
    queryFn: () => api<Paginated<Client>>(`/clients?${params.toString()}`),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["clients"] });

  const revokeMutation = useMutation({
    mutationFn: (client: Client) =>
      api(`/clients/${client.id}/account`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast.success("أُلغي حساب العميل على الموقع");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "حدث خطأ"),
  });

  const deleteMutation = useMutation({
    mutationFn: (client: Client) => api(`/clients/${client.id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast.success("تم حذف العميل");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "حدث خطأ"),
  });

  const columns: ColumnDef<Client, unknown>[] = [
    {
      accessorKey: "name",
      enableHiding: false,
      header: ({ column }) => <SortableHeader column={column}>العميل</SortableHeader>,
      cell: ({ row }) => (
        <Link
          href={`/clients/${row.original.id}`}
          className="font-medium underline-offset-4 hover:underline"
        >
          {row.original.name}
        </Link>
      ),
    },
    {
      accessorKey: "type",
      meta: { label: "النوع" },
      header: "النوع",
      cell: ({ row }) => (
        <ToneBadge tone={row.original.type === "company" ? "blue" : "slate"}>
          {row.original.type === "company" ? "شركة" : "فرد"}
        </ToneBadge>
      ),
    },
    {
      id: "contact",
      meta: { label: "التواصل" },
      header: "التواصل",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          <span dir="ltr">{row.original.phone ?? "—"}</span>
          {row.original.email && (
            <>
              {" · "}
              <span dir="ltr">{row.original.email}</span>
            </>
          )}
        </span>
      ),
    },
    {
      id: "account",
      meta: { label: "حساب الموقع" },
      header: "حساب الموقع",
      cell: ({ row }) => {
        const client = row.original;
        if (!client.has_account) return <span className="text-xs text-muted-foreground">—</span>;

        return (
          <ToneBadge tone={client.status === "suspended" ? "red" : "green"}>
            {client.status === "suspended" ? "موقوف" : "مُفعّل"}
          </ToneBadge>
        );
      },
    },
    {
      accessorKey: "projects_count",
      meta: { label: "المشاريع" },
      header: ({ column }) => <SortableHeader column={column}>المشاريع</SortableHeader>,
      cell: ({ row }) => row.original.projects_count ?? 0,
    },
    {
      accessorKey: "created_at",
      meta: { label: "أضيف في" },
      header: ({ column }) => <SortableHeader column={column}>أضيف في</SortableHeader>,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {dateFormatter.format(new Date(row.original.created_at))}
        </span>
      ),
    },
    {
      id: "actions",
      enableHiding: false,
      header: "",
      cell: ({ row }) => {
        const client = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem asChild>
                <Link href={`/clients/${client.id}`}>
                  <UserRound className="size-4" />
                  ملف العميل
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setEditing(client)}>
                <Pencil className="size-4" />
                تعديل
              </DropdownMenuItem>
              {client.has_account && (
                <DropdownMenuItem
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
                      revokeMutation.mutate(client);
                  }}
                >
                  <ShieldOff className="size-4" />
                  إلغاء حساب الموقع
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                variant="destructive"
                onClick={async () => {
                  if (
                    await confirm({
                      title: `حذف العميل «${client.name}»؟`,
                      description: "لا يمكن حذف عميل لديه مشاريع مسجلة.",
                      confirmLabel: "حذف",
                      destructive: true,
                    })
                  )
                    deleteMutation.mutate(client);
                }}
              >
                <Trash2 className="size-4" />
                حذف
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="العملاء" description="سجل عملاء المكتب وبيانات التواصل">
        <Button onClick={() => setEditing("new")}>
          <Plus className="size-4" />
          عميل جديد
        </Button>
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
        emptyTitle="لا يوجد عملاء بعد"
        emptyDescription="أضف أول عميل لبدء تسجيل المشاريع."
        totalLabel={(total) => `${total} عميل`}
        toolbar={
          <div className="relative min-w-56 max-w-md flex-1">
            <Search className="absolute end-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="بحث بالاسم أو الهاتف أو البريد…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              className="h-8 border-transparent bg-background pe-8 text-[13px] shadow-none focus-visible:border-ring"
            />
          </div>
        }
      />

      <ClientFormDialog
        key={editing === "new" ? "new" : editing ? `edit-${editing.id}` : "closed"}
        client={editing === "new" ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={invalidate}
      />
    </div>
  );
}
