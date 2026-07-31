"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { QuoteRequest } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/field";

const CURRENCIES = ["EGP", "USD", "EUR", "SAR", "AED"];

/** Price a request and (optionally) mail the answer to the requester. */
export function RespondDialog({
  quote,
  open,
  onClose,
  onSaved,
}: {
  quote: QuoteRequest;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(() => ({
    quoted_amount: quote.quoted_amount ?? "",
    currency: quote.currency || "EGP",
    turnaround_days: quote.turnaround_days?.toString() ?? "",
    response_note: quote.response_note ?? "",
  }));
  const [notify, setNotify] = useState(true);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  const resend = quote.responded_at !== null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});

    try {
      await api(`/quote-requests/${quote.id}/respond`, {
        method: "POST",
        json: {
          quoted_amount: Number(form.quoted_amount),
          currency: form.currency,
          turnaround_days: form.turnaround_days ? Number(form.turnaround_days) : null,
          response_note: form.response_note || null,
          notify_client: notify,
        },
      });
      toast.success(notify ? "أُرسل عرض السعر إلى العميل" : "حُفظ عرض السعر بدون إشعار");
      onSaved();
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.errors) setErrors(error.errors);
      else toast.error(error instanceof Error ? error.message : "حدث خطأ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{resend ? "تعديل عرض السعر" : "إرسال عرض السعر"}</DialogTitle>
          <DialogDescription>
            يظهر العرض للعميل فوراً على صفحة تتبع الطلب برقم {quote.reference}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto_1fr]">
            <Field label="التكلفة" htmlFor="r-amount" error={errors.quoted_amount?.[0]}>
              <Input
                id="r-amount"
                type="number"
                min={0}
                step="0.01"
                required
                autoFocus
                dir="ltr"
                className="text-left"
                value={form.quoted_amount}
                onChange={(e) => setForm((f) => ({ ...f, quoted_amount: e.target.value }))}
              />
            </Field>
            <Field label="العملة" htmlFor="r-currency" error={errors.currency?.[0]}>
              {/* A short native list — the value is a free-form 3-letter code server-side. */}
              <select
                id="r-currency"
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
              >
                {CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="مدة التنفيذ (أيام)"
              htmlFor="r-days"
              error={errors.turnaround_days?.[0]}
            >
              <Input
                id="r-days"
                type="number"
                min={1}
                dir="ltr"
                className="text-left"
                placeholder="3"
                value={form.turnaround_days}
                onChange={(e) => setForm((f) => ({ ...f, turnaround_days: e.target.value }))}
              />
            </Field>
          </div>

          <Field
            label="ملاحظات تظهر للعميل"
            htmlFor="r-note"
            error={errors.response_note?.[0]}
          >
            <Textarea
              id="r-note"
              rows={4}
              placeholder="مثال: السعر يشمل التصديق والختم على كل صفحة، والتسليم إلكترونياً ونسخة ورقية."
              value={form.response_note}
              onChange={(e) => setForm((f) => ({ ...f, response_note: e.target.value }))}
            />
          </Field>

          <label className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
            <Switch checked={notify} onCheckedChange={setNotify} className="mt-0.5" />
            <span className="grid gap-0.5">
              <span className="text-sm font-medium">إرسال العرض بالبريد الإلكتروني</span>
              <span className="text-xs text-muted-foreground">
                يصل إلى <span dir="ltr">{quote.email}</span>. أوقفه إن كنت أبلغت العميل هاتفياً.
              </span>
            </span>
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              إلغاء
            </Button>
            <Button type="submit" loading={submitting}>
              <Send className="size-4" />
              {resend ? "حفظ وإعادة الإرسال" : "إرسال العرض"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
