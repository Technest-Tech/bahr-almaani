"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, FileText, Plus, ReceiptText } from "lucide-react";
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

      {creating && (
        <NewInvoiceDialog
          open
          onClose={() => setCreating(false)}
          onIssued={(invoice) => {
            queryClient.invalidateQueries({ queryKey: ["invoices"] });
            // Hand the office the document immediately — printing it is the
            // whole point of the window.
            download(`/invoices/${invoice.id}/download`, `${invoice.number}.pdf`).catch(() =>
              toast.error("صدرت الفاتورة لكن تعذر تحميلها — حمّلها من القائمة"),
            );
          }}
        />
      )}
    </div>
  );
}

function NewInvoiceDialog({
  open,
  onClose,
  onIssued,
}: {
  open: boolean;
  onClose: () => void;
  onIssued: (invoice: Invoice) => void;
}) {
  const [clientId, setClientId] = useState<string>("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [mode, setMode] = useState<"unit" | "total">("unit");
  const [unitPrice, setUnitPrice] = useState("");
  const [total, setTotal] = useState("");
  const [currency, setCurrency] = useState("EGP");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: clients } = useQuery({
    queryKey: ["clients", "picker"],
    queryFn: () => api<Paginated<Client>>("/clients?per_page=100").then((r) => r.data),
  });

  const { data: billable, isLoading: loadingBillable } = useQuery({
    queryKey: ["billable-projects", clientId],
    queryFn: () =>
      api<{ data: BillableProject[] }>(`/invoices/billable?client_id=${clientId}`).then(
        (r) => r.data,
      ),
    enabled: clientId !== "",
  });

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
    try {
      const response = await api<{ data: Invoice }>("/invoices", {
        method: "POST",
        json: {
          client_id: Number(clientId),
          project_ids: chosen.map((project) => project.id),
          unit_price: mode === "unit" ? Number(unitPrice) : null,
          amount: mode === "total" ? Number(total) : null,
          currency,
          notes: notes || null,
        },
      });
      toast.success(`صدرت الفاتورة ${response.data.number}`);
      onIssued(response.data);
      onClose();
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.errors
          ? Object.values(err.errors)[0][0]
          : err instanceof Error
            ? err.message
            : "تعذر إصدار الفاتورة",
      );
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>فاتورة جديدة</DialogTitle>
          <DialogDescription>
            اختر العميل ثم حدد الأعمال المكتملة التي تشملها الفاتورة — عدد الصفحات يُجمع من
            الملفات المُسلَّمة تلقائياً.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="العميل" htmlFor="inv-client">
            <Select
              value={clientId}
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
                  لا توجد أعمال مكتملة غير مفوترة لهذا العميل.
                </p>
              ) : (
                <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border">
                  {billable.map((project) => (
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
              إصدار الفاتورة
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
