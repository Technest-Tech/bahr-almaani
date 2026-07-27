"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Ban,
  CheckCircle2,
  Languages,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { ROLE_LABELS, type Paginated, type Role, type User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { ToneBadge } from "@/components/tone-badge";
import { useConfirm } from "@/components/confirm";
import { UserFormDialog } from "@/components/users/user-form-dialog";
import { LanguagePairsDialog } from "@/components/users/language-pairs-dialog";

const dateFormatter = new Intl.DateTimeFormat("ar-EG", {
  dateStyle: "medium",
  timeStyle: "short",
});

const ALL = "__all__";

export default function UsersPage() {
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const [q, setQ] = useState("");
  const [role, setRole] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [page, setPage] = useState(1);
  const [formUser, setFormUser] = useState<User | null | "new">(null);
  const [pairsUser, setPairsUser] = useState<User | null>(null);

  const params = new URLSearchParams({ page: String(page) });
  if (q) params.set("q", q);
  if (role !== ALL) params.set("role", role);
  if (status !== ALL) params.set("status", status);

  const { data, isLoading } = useQuery({
    queryKey: ["users", q, role, status, page],
    queryFn: () => api<Paginated<User>>(`/users?${params.toString()}`),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["users"] });

  const statusMutation = useMutation({
    mutationFn: ({ user, newStatus }: { user: User; newStatus: string }) =>
      api(`/users/${user.id}/status`, { method: "PUT", json: { status: newStatus } }),
    onSuccess: (_, { newStatus }) => {
      invalidate();
      toast.success(newStatus === "suspended" ? "تم إيقاف الحساب فوراً" : "تم تفعيل الحساب");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "حدث خطأ"),
  });

  const deleteMutation = useMutation({
    mutationFn: (user: User) => api(`/users/${user.id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast.success("تم حذف المستخدم");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "حدث خطأ"),
  });

  const columns: ColumnDef<User, unknown>[] = [
    {
      accessorKey: "name",
      header: "المستخدم",
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.name}</p>
          <p dir="ltr" className="text-start text-xs text-muted-foreground">
            {row.original.email}
          </p>
        </div>
      ),
    },
    {
      id: "roles",
      header: "الدور",
      cell: ({ row }) => (
        <ToneBadge tone={row.original.roles.includes("admin") ? "teal" : "blue"}>
          {row.original.roles.map((r) => ROLE_LABELS[r as Role] ?? r).join("، ") || "—"}
        </ToneBadge>
      ),
    },
    {
      accessorKey: "status",
      header: "الحالة",
      cell: ({ row }) =>
        row.original.status === "active" ? (
          <ToneBadge tone="green">نشط</ToneBadge>
        ) : (
          <ToneBadge tone="red">موقوف</ToneBadge>
        ),
    },
    {
      accessorKey: "last_login_at",
      header: "آخر دخول",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.last_login_at
            ? dateFormatter.format(new Date(row.original.last_login_at))
            : "لم يسجل بعد"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const user = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => setFormUser(user)}>
                <Pencil className="size-4" />
                تعديل البيانات
              </DropdownMenuItem>
              {user.roles.includes("translator") && (
                <DropdownMenuItem onClick={() => setPairsUser(user)}>
                  <Languages className="size-4" />
                  أزواج اللغات
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {user.status === "active" ? (
                <DropdownMenuItem
                  onClick={async () => {
                    if (
                      await confirm({
                        title: `إيقاف حساب «${user.name}»؟`,
                        description:
                          "سيُطرد المستخدم من النظام فوراً وتُلغى جلساته النشطة، ولن يستطيع الدخول حتى يُعاد تفعيله.",
                        confirmLabel: "إيقاف الحساب",
                        destructive: true,
                      })
                    )
                      statusMutation.mutate({ user, newStatus: "suspended" });
                  }}
                >
                  <Ban className="size-4" />
                  إيقاف الحساب
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={() => statusMutation.mutate({ user, newStatus: "active" })}
                >
                  <CheckCircle2 className="size-4" />
                  تفعيل الحساب
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                variant="destructive"
                onClick={async () => {
                  if (
                    await confirm({
                      title: `حذف «${user.name}» نهائياً؟`,
                      description: "لا يمكن التراجع عن هذا الإجراء.",
                      confirmLabel: "حذف",
                      destructive: true,
                    })
                  )
                    deleteMutation.mutate(user);
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">المستخدمون</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            إدارة فريق العمل والأدوار والصلاحيات
          </p>
        </div>
        <Button onClick={() => setFormUser("new")}>
          <Plus className="size-4" />
          مستخدم جديد
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-60 flex-1">
          <Search className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="بحث بالاسم أو البريد…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            className="pe-9"
          />
        </div>
        <Select value={role} onValueChange={(v) => { setRole(v); setPage(1); }}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="الدور" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>كل الأدوار</SelectItem>
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="الحالة" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>كل الحالات</SelectItem>
            <SelectItem value="active">نشط</SelectItem>
            <SelectItem value="suspended">موقوف</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={data?.data}
        loading={isLoading}
        meta={data?.meta}
        onPageChange={setPage}
        emptyTitle="لا يوجد مستخدمون مطابقون"
        emptyDescription="جرّب تعديل الفلاتر أو أضف مستخدماً جديداً."
        totalLabel={(total) => `${total} مستخدم`}
      />

      <UserFormDialog
        key={formUser === "new" ? "new" : formUser ? `edit-${formUser.id}` : "closed"}
        open={formUser !== null}
        user={formUser === "new" ? null : formUser}
        onClose={() => setFormUser(null)}
        onSaved={invalidate}
      />
      <LanguagePairsDialog
        key={pairsUser ? `pairs-${pairsUser.id}` : "none"}
        user={pairsUser}
        onClose={() => setPairsUser(null)}
        onSaved={invalidate}
      />
    </div>
  );
}
