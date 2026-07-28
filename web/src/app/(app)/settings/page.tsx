"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Bell, Mail } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { ROLE_LABELS, type Role } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { FormSection } from "@/components/form-section";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/lib/auth";

interface NotificationFamily {
  key: string;
  label: string;
  description: string;
}

interface PreferencesResponse {
  data: Record<string, boolean>;
  families: NotificationFamily[];
}

export default function SettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  // Pending switch flips, keyed by family — empty means "nothing to save".
  const [draft, setDraft] = useState<Record<string, boolean>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: () => api<PreferencesResponse>("/notification-preferences"),
  });

  const saved = data?.data ?? {};
  const current = useMemo(() => ({ ...saved, ...draft }), [saved, draft]);
  const changed = Object.keys(draft).filter((key) => draft[key] !== saved[key]);

  const mutation = useMutation({
    mutationFn: (preferences: Record<string, boolean>) =>
      api<PreferencesResponse & { message: string }>("/notification-preferences", {
        method: "PUT",
        json: { preferences },
      }),
    onSuccess: (response) => {
      queryClient.setQueryData(["notification-preferences"], {
        data: response.data,
        families: response.families,
      });
      setDraft({});
      toast.success(response.message);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "تعذر حفظ التفضيلات"),
  });

  function toggle(key: string, value: boolean) {
    setDraft((previous) => ({ ...previous, [key]: value }));
  }

  function save() {
    mutation.mutate(Object.fromEntries(changed.map((key) => [key, current[key]])));
  }

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="الإعدادات"
        description="تفضيلاتك الشخصية داخل النظام — تخصّك وحدك ولا تؤثر على بقية المستخدمين."
      />

      <Card className="overflow-hidden py-0">
        <CardContent className="divide-y p-0">
          <FormSection
            title="الحساب"
            description="بياناتك كما هي مسجّلة لدى الإدارة. لتعديلها راجع مدير النظام."
          >
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">الاسم</dt>
                <dd className="mt-1 text-sm font-medium">{user?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">البريد الإلكتروني</dt>
                <dd className="mt-1 text-sm font-medium">
                  {/* bdi keeps the LTR address intact without pulling it out of the RTL column. */}
                  <bdi>{user?.email ?? "—"}</bdi>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">الدور</dt>
                <dd className="mt-1 text-sm font-medium">
                  {user?.roles.map((role) => ROLE_LABELS[role as Role] ?? role).join("، ") || "—"}
                </dd>
              </div>
            </dl>
          </FormSection>

          <FormSection
            title="إشعارات البريد"
            description="اختر ما يصلك على البريد الإلكتروني. إشعارات الجرس داخل النظام تبقى مفعّلة دائماً."
          >
            <div className="flex items-start gap-2.5 rounded-lg border border-dashed bg-muted/40 px-4 py-3 text-[13px] text-muted-foreground">
              <Bell className="mt-0.5 size-4 shrink-0 text-primary" />
              <p className="leading-relaxed">
                كل الأحداث تُسجَّل في جرس الإشعارات وتظهر فور وقوعها — الإيقاف هنا يمنع نسخة
                البريد فقط.
              </p>
            </div>

            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-16 w-full rounded-lg" />
                ))}
              </div>
            ) : (
              <div className="divide-y overflow-hidden rounded-lg border">
                {data?.families.map((family) => (
                  <label
                    key={family.key}
                    htmlFor={`pref-${family.key}`}
                    className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3.5 transition-colors hover:bg-muted/50"
                  >
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">{family.label}</p>
                      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                        {family.description}
                      </p>
                    </div>
                    <Switch
                      id={`pref-${family.key}`}
                      checked={current[family.key] ?? true}
                      onCheckedChange={(value) => toggle(family.key, value)}
                      aria-label={family.label}
                    />
                  </label>
                ))}
              </div>
            )}
          </FormSection>
        </CardContent>

        <CardFooter className="justify-between gap-3 border-t bg-muted/40 py-4!">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Mail className="size-3.5" />
            {changed.length ? "لديك تغييرات غير محفوظة" : "كل التغييرات محفوظة"}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!changed.length || mutation.isPending}
              onClick={() => setDraft({})}
            >
              تراجع
            </Button>
            <Button
              type="button"
              disabled={!changed.length}
              loading={mutation.isPending}
              onClick={save}
            >
              حفظ التفضيلات
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
