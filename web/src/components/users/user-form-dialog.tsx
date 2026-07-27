"use client";

import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { ROLE_LABELS, type User } from "@/lib/types";
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
import { Field } from "@/components/field";

interface Props {
  open: boolean;
  user: User | null; // null = create mode
  onClose: () => void;
  onSaved: () => void;
}

/** Parent remounts this dialog via `key`, so state initializes cleanly from props. */
export function UserFormDialog({ open, user, onClose, onSaved }: Props) {
  const [form, setForm] = useState(() => ({
    name: user?.name ?? "",
    email: user?.email ?? "",
    phone: user?.phone ?? "",
    password: "",
    role: user?.roles[0] ?? "translator",
  }));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});

    const payload: Record<string, string> = {
      name: form.name,
      email: form.email,
      phone: form.phone,
      role: form.role,
    };
    if (form.password) payload.password = form.password;

    try {
      if (user) {
        await api(`/users/${user.id}`, { method: "PUT", json: payload });
        toast.success("تم حفظ التعديلات");
      } else {
        await api("/users", { method: "POST", json: payload });
        toast.success("تم إنشاء المستخدم");
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
          <DialogTitle>{user ? `تعديل: ${user.name}` : "مستخدم جديد"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="الاسم الكامل" htmlFor="u-name" error={errors.name?.[0]}>
            <Input
              id="u-name"
              required
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="البريد الإلكتروني" htmlFor="u-email" error={errors.email?.[0]}>
              <Input
                id="u-email"
                type="email"
                dir="ltr"
                required
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
              />
            </Field>
            <Field label="رقم الهاتف" htmlFor="u-phone" error={errors.phone?.[0]}>
              <Input
                id="u-phone"
                dir="ltr"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="الدور" htmlFor="u-role" error={errors.role?.[0]}>
              <Select value={form.role} onValueChange={(value) => set("role", value)}>
                <SelectTrigger id="u-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ROLE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              label={
                <>
                  كلمة المرور{" "}
                  {user && (
                    <span className="text-xs font-normal text-muted-foreground">
                      (اتركها فارغة للإبقاء)
                    </span>
                  )}
                </>
              }
              htmlFor="u-password"
              error={errors.password?.[0]}
            >
              <Input
                id="u-password"
                type="password"
                dir="ltr"
                required={!user}
                minLength={8}
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
              />
            </Field>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              إلغاء
            </Button>
            <Button type="submit" loading={submitting}>
              {user ? "حفظ التعديلات" : "إنشاء المستخدم"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
