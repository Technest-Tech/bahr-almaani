"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { Client } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/field";
import { ToneBadge } from "@/components/tone-badge";

/**
 * Create or edit a client, including the website account (M15).
 *
 * Shared by the clients table and the client file page: setting a password is how
 * the office opens an account for a client it already has on record, and that has
 * to be reachable from the page that says the client has none.
 */
export function ClientFormDialog({
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
    status: client?.status ?? "active",
  }));
  // Kept out of `form` so an untouched dialog never sends the field at all — an
  // empty password means "leave the account as it is", not "clear it".
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  const hasAccount = client?.has_account ?? false;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});

    const payload = {
      ...form,
      ...(password
        ? { password, password_confirmation: passwordConfirmation }
        : {}),
    };

    try {
      if (client) {
        await api(`/clients/${client.id}`, { method: "PUT", json: payload });
        toast.success(password ? "تم الحفظ وتحديث كلمة المرور" : "تم حفظ التعديلات");
      } else {
        await api("/clients", { method: "POST", json: payload });
        toast.success(password ? "تمت إضافة العميل مع حساب دخول" : "تمت إضافة العميل");
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
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
                required={password.length > 0 || hasAccount}
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

          {/* M15 — the client's own account on the website. Optional: most rows in
              this table are walk-in customers the office simply keeps on file. */}
          <div className="space-y-4 rounded-xl border bg-muted/30 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-[13.5px] font-semibold">
                <KeyRound className="size-4 text-muted-foreground" />
                حساب الدخول على الموقع
              </p>
              {hasAccount && (
                <ToneBadge tone={form.status === "suspended" ? "red" : "green"}>
                  {form.status === "suspended" ? "موقوف" : "مُفعّل"}
                </ToneBadge>
              )}
            </div>

            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              {hasAccount
                ? "لهذا العميل حساب بالفعل. اترك الحقلين فارغين للإبقاء على كلمة مروره، أو اكتب كلمة مرور جديدة لإعادة تعيينها — ستُنهى جلساته المفتوحة."
                : "اكتب كلمة مرور لفتح حساب للعميل يدخل به من الموقع ويتابع مشاريعه وفواتيره. اتركها فارغة إن كان العميل سجلاً في المكتب فقط."}
            </p>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label={hasAccount ? "كلمة مرور جديدة" : "كلمة المرور"}
                htmlFor="c-password"
                error={errors.password?.[0]}
                hint="٨ أحرف على الأقل"
              >
                <Input
                  id="c-password"
                  type="password"
                  dir="ltr"
                  className="text-left"
                  autoComplete="new-password"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <Field label="تأكيد كلمة المرور" htmlFor="c-password2">
                <Input
                  id="c-password2"
                  type="password"
                  dir="ltr"
                  className="text-left"
                  autoComplete="new-password"
                  required={password.length > 0}
                  value={passwordConfirmation}
                  onChange={(e) => setPasswordConfirmation(e.target.value)}
                />
              </Field>
            </div>

            {(hasAccount || password) && (
              <Field label="حالة الحساب" htmlFor="c-status">
                <Select
                  value={form.status}
                  onValueChange={(value) =>
                    setForm((f) => ({ ...f, status: value as Client["status"] }))
                  }
                >
                  <SelectTrigger id="c-status" className="w-full sm:w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">مُفعّل</SelectItem>
                    <SelectItem value="suspended">موقوف</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}
          </div>

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
