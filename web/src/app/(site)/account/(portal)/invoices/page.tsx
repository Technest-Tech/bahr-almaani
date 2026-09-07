"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Download, Receipt } from "lucide-react";
import { toast } from "sonner";
import { downloadFile } from "@/lib/api";
import { clientApi } from "@/lib/client-auth";
import type { Invoice, Paginated } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const dateFormatter = new Intl.DateTimeFormat("ar-EG", { dateStyle: "long" });

const numberFormatter = new Intl.NumberFormat("ar-EG");

export default function AccountInvoicesPage() {
  const [busy, setBusy] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["client-invoices"],
    queryFn: () => clientApi<Paginated<Invoice>>("/client/invoices"),
  });

  async function download(invoice: Invoice) {
    setBusy(invoice.id);
    try {
      await downloadFile(
        `/client/invoices/${invoice.id}/download`,
        `${invoice.number}.pdf`,
        { realm: "client" },
      );
    } catch {
      toast.error("تعذر تحميل الفاتورة. تواصل مع المكتب.");
    } finally {
      setBusy(null);
    }
  }

  if (isLoading && !data) {
    return (
      <div className="grid gap-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-28 rounded-xl" />
        ))}
      </div>
    );
  }

  if (!data || data.data.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-6 py-12 text-center">
        <Receipt className="mx-auto size-8 text-muted-foreground" />
        <p className="mt-3 font-medium">لا توجد فواتير بعد</p>
        <p className="mt-1 text-sm text-muted-foreground">
          تصدر الفاتورة بعد تسليم العمل، وستجدها هنا جاهزة للتحميل.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {data.data.map((invoice) => (
        <div key={invoice.id} className="rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-sm font-semibold" dir="ltr">
                {invoice.number}
              </p>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                {dateFormatter.format(new Date(invoice.issued_at))}
              </p>
            </div>
            <div className="text-end">
              <p className="text-xl font-bold tracking-tight tabular-nums">
                {Number(invoice.amount).toLocaleString("ar-EG", { minimumFractionDigits: 2 })}{" "}
                <span className="text-sm font-semibold text-muted-foreground">
                  {invoice.currency}
                </span>
              </p>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                {numberFormatter.format(invoice.total_pages)} صفحة
              </p>
            </div>
          </div>

          {invoice.line_items.length > 0 && (
            <ul className="mt-3 space-y-1 border-t pt-3 text-[12.5px] text-muted-foreground">
              {invoice.line_items.map((item) => (
                <li key={item.project_id} className="flex flex-wrap justify-between gap-2">
                  <span className="truncate">
                    <span dir="ltr" className="font-mono">
                      {item.code}
                    </span>{" "}
                    — {item.title}
                  </span>
                  {item.pages !== null && (
                    <span className="tabular-nums">
                      {numberFormatter.format(item.pages)} صفحة
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              variant="outline"
              loading={busy === invoice.id}
              onClick={() => download(invoice)}
            >
              <Download className="size-4" />
              تحميل الفاتورة
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
