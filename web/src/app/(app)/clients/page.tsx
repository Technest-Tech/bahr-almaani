"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { Client, Paginated } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { DataTable, SortableHeader } from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { ToneBadge } from "@/components/tone-badge";
import { useConfirm } from "@/components/confirm";

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
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
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
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => setEditing(client)}>
                <Pencil className="size-4" />
                تعديل
              </DropdownMenuItem>
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

function ClientFormDialog({
  client,
  open,
  onClose,
  onSaved,
}: {
  client: Client | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(() => ({
    name: client?.name ?? "",
    type: client?.type ?? "individual",
    phone: client?.phone ?? "",
    email: client?.email ?? "",
    notes: client?.notes ?? "",
  }));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});
    try {
      if (client) {
        await api(`/clients/${client.id}`, { method: "PUT", json: form });
        toast.success("تم حفظ التعديلات");
      } else {
        await api("/clients", { method: "POST", json: form });
        toast.success("تمت إضافة العميل");
      }
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.errors) setErrors(err.errors);
      else toast.error(err instanceof Error ? err.message : "حدث خطأ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{client ? `تعديل: ${client.name}` : "عميل جديد"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="اسم العميل" htmlFor="c-name" error={errors.name?.[0]}>
              <Input
                id="c-name"
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Field>
            <Field label="النوع" htmlFor="c-type">
              <Select
                value={form.type}
                onValueChange={(value) =>
                  setForm((f) => ({ ...f, type: value as Client["type"] }))
                }
              >
                <SelectTrigger id="c-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="individual">فرد</SelectItem>
                  <SelectItem value="company">شركة</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="الهاتف" htmlFor="c-phone" error={errors.phone?.[0]}>
              <Input
                id="c-phone"
                dir="ltr"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </Field>
            <Field label="البريد الإلكتروني" htmlFor="c-email" error={errors.email?.[0]}>
              <Input
                id="c-email"
                type="email"
                dir="ltr"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </Field>
          </div>
          <Field label="ملاحظات" htmlFor="c-notes">
            <Textarea
              id="c-notes"
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              إلغاء
            </Button>
            <Button type="submit" loading={submitting}>
              {client ? "حفظ التعديلات" : "إضافة العميل"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
