"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Ban,
  CheckCircle2,
  Languages,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/api";
import { ROLE_LABELS, type Paginated, type Role, type User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { UserFormDialog } from "@/components/users/user-form-dialog";
import { LanguagePairsDialog } from "@/components/users/language-pairs-dialog";

const dateFormatter = new Intl.DateTimeFormat("ar-EG", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function UsersPage() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [formUser, setFormUser] = useState<User | null | "new">(null);
  const [pairsUser, setPairsUser] = useState<User | null>(null);

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (role) params.set("role", role);
  if (status) params.set("status", status);
  params.set("page", String(page));

  const { data, isLoading } = useQuery({
    queryKey: ["users", q, role, status, page],
    queryFn: () => api<Paginated<User>>(`/users?${params.toString()}`),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["users"] });

  const statusMutation = useMutation({
    mutationFn: ({ user, newStatus }: { user: User; newStatus: string }) =>
      api(`/users/${user.id}/status`, { method: "PUT", json: { status: newStatus } }),
    onSuccess: invalidate,
    onError: (err) => alert(err instanceof Error ? err.message : "حدث خطأ"),
  });

  const deleteMutation = useMutation({
    mutationFn: (user: User) => api(`/users/${user.id}`, { method: "DELETE" }),
    onSuccess: invalidate,
    onError: (err) => alert(err instanceof Error ? err.message : "حدث خطأ"),
  });

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">المستخدمون</h1>
          <p className="mt-1 text-sm text-slate-500">
            إدارة فريق العمل والأدوار والصلاحيات
          </p>
        </div>
        <Button onClick={() => setFormUser("new")}>
          <Plus className="size-4" />
          مستخدم جديد
        </Button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative min-w-64 flex-1">
          <Search className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
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
        <Select
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setPage(1);
          }}
          className="w-44"
        >
          <option value="">كل الأدوار</option>
          {Object.entries(ROLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="w-40"
        >
          <option value="">كل الحالات</option>
          <option value="active">نشط</option>
          <option value="suspended">موقوف</option>
        </Select>
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-start text-xs text-slate-500">
                <th className="px-4 py-3 text-start font-medium">المستخدم</th>
                <th className="px-4 py-3 text-start font-medium">الدور</th>
                <th className="px-4 py-3 text-start font-medium">الحالة</th>
                <th className="px-4 py-3 text-start font-medium">آخر دخول</th>
                <th className="px-4 py-3 text-start font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-slate-400">
                    جارِ التحميل…
                  </td>
                </tr>
              )}
              {!isLoading && data?.data.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-slate-400">
                    لا يوجد مستخدمون مطابقون
                  </td>
                </tr>
              )}
              {data?.data.map((user) => (
                <tr key={user.id} className="border-b border-slate-50 hover:bg-slate-50/40">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{user.name}</p>
                    <p dir="ltr" className="text-start text-xs text-slate-400">
                      {user.email}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={user.roles.includes("admin") ? "teal" : "blue"}>
                      {user.roles.map((r) => ROLE_LABELS[r as Role] ?? r).join("، ") || "—"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {user.status === "active" ? (
                      <Badge tone="green">نشط</Badge>
                    ) : (
                      <Badge tone="red">موقوف</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {user.last_login_at
                      ? dateFormatter.format(new Date(user.last_login_at))
                      : "لم يسجل بعد"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        title="تعديل"
                        onClick={() => setFormUser(user)}
                        className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <Pencil className="size-4" />
                      </button>
                      {user.roles.includes("translator") && (
                        <button
                          title="أزواج اللغات"
                          onClick={() => setPairsUser(user)}
                          className="rounded-lg p-2 text-slate-400 hover:bg-teal-50 hover:text-teal-700"
                        >
                          <Languages className="size-4" />
                        </button>
                      )}
                      {user.status === "active" ? (
                        <button
                          title="إيقاف"
                          onClick={() => {
                            if (confirm(`إيقاف حساب «${user.name}»؟ سيُطرد من النظام فوراً.`))
                              statusMutation.mutate({ user, newStatus: "suspended" });
                          }}
                          className="rounded-lg p-2 text-slate-400 hover:bg-amber-50 hover:text-amber-600"
                        >
                          <Ban className="size-4" />
                        </button>
                      ) : (
                        <button
                          title="تفعيل"
                          onClick={() => statusMutation.mutate({ user, newStatus: "active" })}
                          className="rounded-lg p-2 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"
                        >
                          <CheckCircle2 className="size-4" />
                        </button>
                      )}
                      <button
                        title="حذف"
                        onClick={() => {
                          if (confirm(`حذف «${user.name}» نهائياً؟`)) deleteMutation.mutate(user);
                        }}
                        className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.meta.last_page > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm">
            <p className="text-xs text-slate-500">
              {data.meta.total} مستخدم — صفحة {data.meta.current_page} من {data.meta.last_page}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                السابق
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.meta.last_page}
                onClick={() => setPage((p) => p + 1)}
              >
                التالي
              </Button>
            </div>
          </div>
        )}
      </Card>

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
