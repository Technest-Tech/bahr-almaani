"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Client, Paginated } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";

const dateFormatter = new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium" });

export default function ClientsPage() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Client | null | "new">(null);

  const params = new URLSearchParams({ page: String(page) });
  if (q) params.set("q", q);

  const { data, isLoading } = useQuery({
    queryKey: ["clients", q, page],
    queryFn: () => api<Paginated<Client>>(`/clients?${params.toString()}`),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["clients"] });

  const deleteMutation = useMutation({
    mutationFn: (client: Client) => api(`/clients/${client.id}`, { method: "DELETE" }),
    onSuccess: invalidate,
    onError: (err) => alert(err instanceof Error ? err.message : "حدث خطأ"),
  });

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">العملاء</h1>
          <p className="mt-1 text-sm text-slate-500">سجل عملاء المكتب وبيانات التواصل</p>
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus className="size-4" />
          عميل جديد
        </Button>
      </div>

      <div className="relative mb-4 max-w-md">
        <Search className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <Input
          placeholder="بحث بالاسم أو الهاتف أو البريد…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          className="pe-9"
        />
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-xs text-slate-500">
                <th className="px-4 py-3 text-start font-medium">العميل</th>
                <th className="px-4 py-3 text-start font-medium">النوع</th>
                <th className="px-4 py-3 text-start font-medium">التواصل</th>
                <th className="px-4 py-3 text-start font-medium">المشاريع</th>
                <th className="px-4 py-3 text-start font-medium">أضيف في</th>
                <th className="px-4 py-3 text-start font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                    جارِ التحميل…
                  </td>
                </tr>
              )}
              {!isLoading && data?.data.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                    لا يوجد عملاء بعد
                  </td>
                </tr>
              )}
              {data?.data.map((client) => (
                <tr key={client.id} className="border-b border-slate-50 hover:bg-slate-50/40">
                  <td className="px-4 py-3 font-medium text-slate-800">{client.name}</td>
                  <td className="px-4 py-3">
                    <Badge tone={client.type === "company" ? "blue" : "slate"}>
                      {client.type === "company" ? "شركة" : "فرد"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    <span dir="ltr">{client.phone ?? "—"}</span>
                    {client.email && (
                      <>
                        {" · "}
                        <span dir="ltr">{client.email}</span>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{client.projects_count ?? 0}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {dateFormatter.format(new Date(client.created_at))}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button
                        title="تعديل"
                        onClick={() => setEditing(client)}
                        className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        title="حذف"
                        onClick={() => {
                          if (confirm(`حذف العميل «${client.name}»؟`)) deleteMutation.mutate(client);
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

        {data && data.meta.last_page > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
            <p className="text-xs text-slate-500">
              {data.meta.total} عميل — صفحة {data.meta.current_page} من {data.meta.last_page}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
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
      if (client) await api(`/clients/${client.id}`, { method: "PUT", json: form });
      else await api("/clients", { method: "POST", json: form });
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.errors) setErrors(err.errors);
      else alert(err instanceof Error ? err.message : "حدث خطأ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={client ? `تعديل: ${client.name}` : "عميل جديد"}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="c-name">اسم العميل</Label>
            <Input
              id="c-name"
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              error={errors.name?.[0]}
            />
          </div>
          <div>
            <Label htmlFor="c-type">النوع</Label>
            <Select
              id="c-type"
              value={form.type}
              onChange={(e) =>
                setForm((f) => ({ ...f, type: e.target.value as Client["type"] }))
              }
            >
              <option value="individual">فرد</option>
              <option value="company">شركة</option>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="c-phone">الهاتف</Label>
            <Input
              id="c-phone"
              dir="ltr"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              error={errors.phone?.[0]}
            />
          </div>
          <div>
            <Label htmlFor="c-email">البريد الإلكتروني</Label>
            <Input
              id="c-email"
              type="email"
              dir="ltr"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              error={errors.email?.[0]}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="c-notes">ملاحظات</Label>
          <textarea
            id="c-notes"
            rows={3}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" loading={submitting}>
            {client ? "حفظ التعديلات" : "إضافة العميل"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
