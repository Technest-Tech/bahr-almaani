"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FileSearch, Layers, Pencil, Plus, Stamp, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, openRendered } from "@/lib/api";
import {
  PLACEMENT_ANCHOR_LABELS,
  PLACEMENT_LAYER_LABELS,
  PLACEMENT_PAGES_LABELS,
  type LetterheadTemplate,
  type TemplateKind,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/page-header";
import { ToneBadge } from "@/components/tone-badge";
import { useConfirm } from "@/components/confirm";
import { TemplateAsset } from "@/components/letterheads/template-asset";
import { TemplateFormDialog } from "@/components/letterheads/template-form-dialog";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

/** One-line summary of the geometry the merge job will apply. */
function placementSummary(template: LetterheadTemplate): string {
  const { placement } = template;
  const parts = [
    PLACEMENT_PAGES_LABELS[placement.pages],
    PLACEMENT_ANCHOR_LABELS[placement.anchor],
    placement.width_mm === null ? "عرض كامل" : `عرض ${placement.width_mm} مم`,
    PLACEMENT_LAYER_LABELS[placement.layer],
  ];
  if (placement.opacity < 1) parts.push(`شفافية ${Math.round(placement.opacity * 100)}٪`);

  const top = placement.content_top_mm ?? 0;
  const bottom = placement.content_bottom_mm ?? 0;
  if (top > 0 || bottom > 0) parts.push(`نطاق النص ${top}/${bottom} مم`);

  return parts.join(" · ");
}

export default function LetterheadsPage() {
  const { can } = useAuth();
  const { confirm } = useConfirm();
  const queryClient = useQueryClient();
  const [formTemplate, setFormTemplate] = useState<LetterheadTemplate | null | "new">(null);
  const [previewingId, setPreviewingId] = useState<number | null>(null);

  const canManage = can("letterheads.manage");

  /** Renders this template over a specimen page and opens the PDF (M9b). */
  async function previewMerge(template: LetterheadTemplate) {
    setPreviewingId(template.id);
    try {
      await openRendered(`/letterheads/${template.id}/preview`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر إنشاء المعاينة");
    } finally {
      setPreviewingId(null);
    }
  }

  const { data, isLoading } = useQuery({
    queryKey: ["letterheads"],
    queryFn: () => api<{ data: LetterheadTemplate[] }>("/letterheads").then((r) => r.data),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["letterheads"] });

  const activeMutation = useMutation({
    mutationFn: ({ template, active }: { template: LetterheadTemplate; active: boolean }) =>
      api(`/letterheads/${template.id}`, { method: "PUT", json: { is_active: active } }),
    onSuccess: (_, { active }) => {
      invalidate();
      toast.success(active ? "تم تفعيل القالب" : "تم إيقاف القالب");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "حدث خطأ"),
  });

  const deleteMutation = useMutation({
    mutationFn: (template: LetterheadTemplate) =>
      api(`/letterheads/${template.id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast.success("تم حذف القالب");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "حدث خطأ"),
  });

  async function remove(template: LetterheadTemplate) {
    if (
      await confirm({
        title: `حذف «${template.name}» نهائياً؟`,
        description: template.in_use
          ? "هذا القالب مستخدم في مشاريع معتمدة ولا يمكن حذفه — أوقفه بدلاً من ذلك."
          : "سيُحذف ملف القالب من المخزن ولا يمكن التراجع عن ذلك.",
        confirmLabel: "حذف",
        destructive: true,
      })
    )
      deleteMutation.mutate(template);
  }

  const sections: { kind: TemplateKind; title: string; description: string; icon: React.ReactNode }[] = [
    {
      kind: "letterhead",
      title: "الترويسات",
      description: "خلفية الورق الرسمي التي تُطبع تحت نص الترجمة",
      icon: <Layers className="size-4" />,
    },
    {
      kind: "stamp",
      title: "الأختام",
      description: "ختم الاعتماد الذي يُطبع فوق الصفحة المحددة",
      icon: <Stamp className="size-4" />,
    },
  ];

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="الترويسات والأختام"
        description="قوالب الترويسة والختم التي تُدمج في الملف النهائي بعد اعتماد المراجعة"
      >
        {canManage && (
          <Button onClick={() => setFormTemplate("new")}>
            <Plus className="size-4" />
            قالب جديد
          </Button>
        )}
      </PageHeader>

      {sections.map((section) => {
        const templates = data?.filter((t) => t.kind === section.kind) ?? [];

        return (
          <section key={section.kind} className="space-y-3">
            <div className="flex items-baseline gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                {section.icon}
                {section.title}
              </h2>
              <span className="text-xs text-muted-foreground">{section.description}</span>
              {!isLoading && (
                <span className="text-xs text-muted-foreground">({templates.length})</span>
              )}
            </div>

            {isLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-72 rounded-xl" />
                ))}
              </div>
            ) : templates.length === 0 ? (
              <div className="rounded-xl border border-dashed bg-card/50 py-12 text-center">
                <p className="text-sm font-medium">
                  لا توجد {section.kind === "stamp" ? "أختام" : "ترويسات"} بعد
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {canManage
                    ? "ارفع القالب المعتمد من الشركة ليصبح متاحاً عند اعتماد المشاريع."
                    : "لم يرفع فريق الإدارة أي قالب بعد."}
                </p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {templates.map((template) => (
                  <article
                    key={template.id}
                    className={cn(
                      "group flex flex-col overflow-hidden rounded-xl border bg-card shadow-xs transition-shadow hover:shadow-md",
                      !template.is_active && "opacity-70",
                    )}
                  >
                    {/* Sheets sit on a plain desk; stamps show a transparency grid. */}
                    <div
                      className={cn(
                        "relative flex items-center justify-center overflow-hidden border-b p-3",
                        template.kind === "stamp"
                          ? "h-40 bg-[repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]"
                          : "h-56 bg-muted/50",
                      )}
                    >
                      <TemplateAsset template={template} />
                      {!template.is_active && (
                        <span className="absolute top-2 end-2">
                          <ToneBadge tone="slate">موقوف</ToneBadge>
                        </span>
                      )}
                    </div>

                    <div className="flex flex-1 flex-col gap-2 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-semibold leading-snug">{template.name}</h3>
                        {template.in_use && <ToneBadge tone="violet">مستخدم</ToneBadge>}
                      </div>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        {placementSummary(template)}
                      </p>
                      <p dir="ltr" className="truncate text-start font-mono text-[11px] text-muted-foreground/70">
                        {template.file_name}
                      </p>

                      {canManage && (
                        <div className="mt-auto flex items-center justify-between border-t pt-3">
                          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                            <Switch
                              checked={template.is_active}
                              disabled={activeMutation.isPending}
                              onCheckedChange={(checked) =>
                                activeMutation.mutate({ template, active: checked })
                              }
                            />
                            فعّال
                          </label>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title="معاينة الدمج على صفحة نموذجية"
                              loading={previewingId === template.id}
                              onClick={() => previewMerge(template)}
                            >
                              <FileSearch className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title="تعديل"
                              onClick={() => setFormTemplate(template)}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title={template.in_use ? "مستخدم في مشاريع — لا يمكن حذفه" : "حذف"}
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => remove(template)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        );
      })}

      <TemplateFormDialog
        key={
          formTemplate === "new" ? "new" : formTemplate ? `edit-${formTemplate.id}` : "closed"
        }
        open={formTemplate !== null}
        template={formTemplate === "new" ? null : formTemplate}
        onClose={() => setFormTemplate(null)}
        onSaved={invalidate}
      />
    </div>
  );
}
