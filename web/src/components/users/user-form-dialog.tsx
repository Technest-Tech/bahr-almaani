"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { ROLE_LABELS, type User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";

interface Props {
  open: boolean;
  user: User | null; // null = create mode
  onClose: () => void;
  onSaved: () => void;
}

const EMPTY_FORM = {
  name: "",
  email: "",
  phone: "",
  password: "",
  role: "translator",
};

/**
 * State initializes from props on mount — the parent remounts this dialog
 * via a `key` per user, so no effect-based reset is needed.
 */
export function UserFormDialog({ open, user, onClose, onSaved }: Props) {
  const [form, setForm] = useState(() =>
    user
      ? {
          name: user.name,
          email: user.email,
          phone: user.phone ?? "",
          password: "",
          role: user.roles[0] ?? "translator",
        }
      : EMPTY_FORM,
  );
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof typeof EMPTY_FORM>(key: K, value: string) {
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
      } else {
        await api("/users", { method: "POST", json: payload });
      }
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
    <Dialog
      open={open}
      onClose={onClose}
      title={user ? `تعديل: ${user.name}` : "مستخدم جديد"}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="u-name">الاسم الكامل</Label>
          <Input
            id="u-name"
            required
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            error={errors.name?.[0]}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="u-email">البريد الإلكتروني</Label>
            <Input
              id="u-email"
              type="email"
              dir="ltr"
              required
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              error={errors.email?.[0]}
            />
          </div>
          <div>
            <Label htmlFor="u-phone">رقم الهاتف</Label>
            <Input
              id="u-phone"
              dir="ltr"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              error={errors.phone?.[0]}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="u-role">الدور</Label>
            <Select
              id="u-role"
              value={form.role}
              onChange={(e) => set("role", e.target.value)}
              error={errors.role?.[0]}
            >
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="u-password">
              كلمة المرور {user && <span className="text-xs text-slate-400">(اتركها فارغة للإبقاء)</span>}
            </Label>
            <Input
              id="u-password"
              type="password"
              dir="ltr"
              required={!user}
              minLength={8}
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              error={errors.password?.[0]}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" loading={submitting}>
            {user ? "حفظ التعديلات" : "إنشاء المستخدم"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
