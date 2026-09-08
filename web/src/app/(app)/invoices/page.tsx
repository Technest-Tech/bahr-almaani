"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, FileText, Pencil, Plus, ReceiptText } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useFileTransfer } from "@/lib/use-transfer";
import type { BillableProject, Client, Invoice, Paginated } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/field";
import { PageHeader } from "@/components/page-header";

const dateFormatter = new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium" });

const money = (value: string | number, currency: string) =>
  `${Number(value).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

export default function InvoicesPage() {
  const queryClient = useQueryClient();
  const { download } = useFileTransfer();
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Invoice | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["invoices", page],
    queryFn: () => api<Paginated<Invoice>>(`/invoices?page=${page}`),
  });

  const columns: ColumnDef<Invoice, unknown>[] = [
    {
      accessorKey: "number",
      enableHiding: false,
      header: "رقم الفاتورة",
      cell: ({ row }) => (
        <span dir="ltr" className="text-start font-mono text-xs font-medium">
          {row.original.number}
        </span>
      ),
    },
    {
      id: "client",
      meta: { label: "العميل" },
      header: "العميل",
      cell: ({ row }) => <span className="font-medium">{row.original.client?.name ?? "—"}</span>,
    },
    {
      accessorKey: "total_pages",
      meta: { label: "الصفحات" },
      header: "الصفحات",
      cell: ({ row }) => (
        <span className="tabular-nums">{row.original.total_pages.toLocaleString("ar-EG")}</span>
      ),
    },
    {
      accessorKey: "amount",
      meta: { label: "المبلغ" },
      header: "المبلغ",
      cell: ({ row }) => (
        <span className="tabular-nums font-medium">
          {money(row.original.amount, row.original.currency)}
        </span>
      ),
    },
    {
      accessorKey: "issued_at",
      meta: { label: "التاريخ" },
      header: "التاريخ",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {dateFormatter.format(new Date(row.original.issued_at))}
        </span>
      ),
    },
    {
      id: "actions",
      enableHiding: false,
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            title="تعديل الفاتورة"
            onClick={() => setEditing(row.original)}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="تحميل الفاتورة"
            onClick={() =>
              download(`/invoices/${row.original.id}/download`, `${row.original.number}.pdf`).catch(
                () => toast.error("تعذر تحميل الفاتورة"),
              )
            }
          >
            <Download className="size-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="الفواتير"
        description="اختر العميل، والنظام يجمع صفحات أعماله المكتملة — اكتب السعر وتصدر الفاتورة"
      >
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          فاتورة جديدة
        </Button>
      </PageHeader>

      <DataTable
        columns={columns}
        data={data?.data}
        loading={isLoading}
        meta={data?.meta}
        onPageChange={setPage}
        emptyTitle="لا توجد فواتير بعد"
        emptyDescription="أصدر أول فاتورة من زر «فاتورة جديدة»."
        totalLabel={(total) => `${total} فاتورة`}
      />

      {(creating || editing) && (
        <InvoiceDialog
          open
          key={editing ? `edit-${editing.id}` : "new"}
          invoice={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={(invoice, wasEdit) => {
            queryClient.invalidateQueries({ queryKey: ["invoices"] });
            // A corrected invoice has a new PDF at the same URL, so both paths
            // hand the office the document — printing it is the whole point of
            // the window.
            download(`/invoices/${invoice.id}/download`, `${invoice.number}.pdf`).catch(() =>
              toast.error(
                wasEdit
                  ? "حُفظت التعديلات لكن تعذر تحميل الفاتورة — حمّلها من القائمة"
                  : "صدرت الفاتورة لكن تعذر تحميلها — حمّلها من القائمة",
              ),
            );
          }}
        />
      )}
    </div>
  );
}

/**
 * Issue a new invoice, or correct one already issued (office request 2026-09-07).
 *
 * One form for both: an edit changes exactly the same fields an issue sets, so a
 * second dialog would be the same 150 lines with a different verb. What an edit
 * cannot touch is the invoice's identity — the number, the issue date and the
 * client — so the client picker is locked rather than hidden, which keeps the
 * dialog readable as "this invoice, corrected" instead of "a new one".
 */
function InvoiceDialog({
  open,
  invoice,
  onClose,
  onSaved,
}: {
  open: boolean;
  invoice: Invoice | null;
  onClose: () => void;
  onSaved: (invoice: Invoice, wasEdit: boolean) => void;
}) {
  const isEdit = invoice !== null;
  const [clientId, setClientId] = useState<string>(
    invoice?.client ? String(invoice.client.id) : "",
  );
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(invoice?.line_items.map((item) => item.project_id) ?? []),
  );
  // A stored unit_price means the office priced per page; its absence means a
  // lump sum was typed, and reopening must land the PM back on that same tab.
  const [mode, setMode] = useState<"unit" | "total">(
    invoice && invoice.unit_price === null ? "total" : "unit",
  );
  const [unitPrice, setUnitPrice] = useState(invoice?.unit_price ?? "");
  const [total, setTotal] = useState(invoice?.amount ?? "");
  const [currency, setCurrency] = useState(invoice?.currency ?? "EGP");
  const [notes, setNotes] = useState(invoice?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);

  const { data: clients } = useQuery({
    queryKey: ["clients", "picker"],
    queryFn: () => api<Paginated<Client>>("/clients?per_page=100").then((r) => r.data),
  });

  const { data: billable, isLoading: loadingBillable } = useQuery({
    queryKey: ["billable-projects", clientId, invoice?.id ?? null],
    queryFn: () => {
      const params = new URLSearchParams({ client_id: clientId });
      // Without this the edit dialog would open with every project the invoice
      // already bills missing from the list, and therefore unchecked.
      if (invoice) params.set("invoice_id", String(invoice.id));
      return api<{ data: BillableProject[] }>(`/invoices/billable?${params}`).then((r) => r.data);
    },
    enabled: clientId !== "",
  });

  /**
   * The rows this invoice already bills, floated to the top of the list.
   *
   * Keyed off the invoice's own line items rather than live `selected`, so the
   * order is stable while the PM ticks boxes — sorting by the live selection
   * would make rows jump under the cursor. Without this an edit opens with its
   * own projects checked but scrolled out of sight below everything else the
   * client has waiting to be billed.
   */
  const billedIds = useMemo(
    () => new Set(invoice?.line_items.map((item) => item.project_id) ?? []),
    [invoice],
  );

  const listed = useMemo(() => {
    const rows = billable ?? [];
    if (billedIds.size === 0) return rows;
    return [...rows].sort(
      (a, b) => Number(billedIds.has(b.id)) - Number(billedIds.has(a.id)),
    );
  }, [billable, billedIds]);

  const chosen = useMemo(
    () => (billable ?? []).filter((project) => selected.has(project.id)),
    [billable, selected],
  );
  const pages = chosen.reduce((sum, project) => sum + (project.pages ?? 0), 0);
  const computedTotal = mode === "unit" && unitPrice !== "" ? pages * Number(unitPrice) : null;

  function toggle(id: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (chosen.length === 0) {
      toast.error("اختر مشروعاً واحداً على الأقل");
      return;
    }
    setSubmitting(true);

    const pricing = {
      project_ids: chosen.map((project) => project.id),
      unit_price: mode === "unit" ? Number(unitPrice) : null,
      amount: mode === "total" ? Number(total) : null,
      currency,
      notes: notes || null,
    };

    try {
      const response = invoice
        ? await api<{ data: Invoice }>(`/invoices/${invoice.id}`, {
            method: "PUT",
            json: pricing,
          })
        : await api<{ data: Invoice }>("/invoices", {
            method: "POST",
            json: { client_id: Number(clientId), ...pricing },
          });

      toast.success(
        invoice
          ? `حُدّثت الفاتورة ${response.data.number}`
          : `صدرت الفاتورة ${response.data.number}`,
      );
      onSaved(response.data, invoice !== null);
      onClose();
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.errors
          ? Object.values(err.errors)[0][0]
          : err instanceof Error
            ? err.message
            : invoice
              ? "تعذر حفظ التعديلات"
              : "تعذر إصدار الفاتورة",
      );
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `تعديل الفاتورة ${invoice.number}` : "فاتورة جديدة"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "يمكنك تصحيح السعر أو الأعمال المشمولة. رقم الفاتورة وتاريخ إصدارها والعميل لا تتغير، ويُعاد إنشاء ملف PDF بالبيانات الجديدة."
              : "اختر العميل ثم حدد الأعمال المكتملة التي تشملها الفاتورة — عدد الصفحات يُجمع من الملفات المُسلَّمة تلقائياً."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field
            label="العميل"
            htmlFor="inv-client"
            hint={isEdit ? "لا يمكن تغيير العميل على فاتورة صادرة." : undefined}
          >
            <Select
              value={clientId}
              disabled={isEdit}
              onValueChange={(value) => {
                setClientId(value);
                setSelected(new Set());
              }}
            >
              <SelectTrigger id="inv-client" className="w-full">
                <SelectValue placeholder="اختر العميل…" />
              </SelectTrigger>
              <SelectContent>
                {clients?.map((client) => (
                  <SelectItem key={client.id} value={String(client.id)}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {clientId !== "" && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">الأعمال القابلة للفوترة</h3>
              {loadingBillable ? (
                <Skeleton className="h-24 rounded-lg" />
              ) : !billable?.length ? (
                <p className="rounded-lg border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">
                  لا توجد أعمال مكتملة قابلة للفوترة لهذا العميل.
                </p>
              ) : (
                <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
                  {listed.map((project) => (
                    <li key={project.id}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/40">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={selected.has(project.id)}
                          onChange={() => toggle(project.id)}
                        />
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-[13px]">
                          {project.title}
                          <span dir="ltr" className="ms-2 font-mono text-[11px] text-muted-foreground">
                            {project.code}
                          </span>
                        </span>
                        {billedIds.has(project.id) && (
                          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                            على الفاتورة
                          </span>
                        )}
                        <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                          {project.pages !== null
                            ? `${project.pages.toLocaleString("ar-EG")} صفحة`
                            : "بدون عدد صفحات"}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              {chosen.length > 0 && (
                <p className="text-[13px] text-muted-foreground">
                  المحدد: {chosen.length.toLocaleString("ar-EG")} مشروع ·{" "}
                  <strong className="text-foreground">
                    {pages.toLocaleString("ar-EG")} صفحة
                  </strong>
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">التسعير</h3>
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  ["unit", "سعر الصفحة"],
                  ["total", "مبلغ إجمالي"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className={`rounded-md border px-3 py-1 text-[13px] transition-colors ${
                    mode === value
                      ? "border-primary bg-primary/10 font-medium text-primary"
                      : "hover:bg-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {mode === "unit" ? (
                <Field label="سعر الصفحة" htmlFor="inv-unit">
                  <Input
                    id="inv-unit"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    dir="ltr"
                    value={unitPrice}
                    onChange={(e) => setUnitPrice(e.target.value)}
                  />
                </Field>
              ) : (
                <Field label="المبلغ الإجمالي" htmlFor="inv-total">
                  <Input
                    id="inv-total"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    dir="ltr"
                    value={total}
                    onChange={(e) => setTotal(e.target.value)}
                  />
                </Field>
              )}
              <Field label="العملة" htmlFor="inv-currency">
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger id="inv-currency" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["EGP", "USD", "EUR", "SAR", "AED"].map((code) => (
                      <SelectItem key={code} value={code}>
                        {code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {computedTotal !== null && pages > 0 && (
              <p className="text-[13px]">
                الإجمالي: {pages.toLocaleString("ar-EG")} صفحة ×{" "}
                {Number(unitPrice).toLocaleString("ar-EG")} ={" "}
                <strong>{money(computedTotal, currency)}</strong>
              </p>
            )}
          </div>

          <Field label="ملاحظات على الفاتورة (اختياري)" htmlFor="inv-notes">
            <Textarea
              id="inv-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              إلغاء
            </Button>
            <Button type="submit" loading={submitting} disabled={chosen.length === 0}>
              <ReceiptText className="size-4" />
              {isEdit ? "حفظ التعديلات" : "إصدار الفاتورة"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
