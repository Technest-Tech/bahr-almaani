"use client";

import Link from "next/link";
import { AlertTriangle, Check } from "lucide-react";
import {
  PLACEMENT_ANCHOR_LABELS,
  PLACEMENT_PAGES_LABELS,
  type LetterheadTemplate,
  type TemplateKind,
} from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { TemplateAsset } from "@/components/letterheads/template-asset";
import { cn } from "@/lib/utils";

/**
 * The letterhead/stamp grid, shared by the PM's approval dialog and the
 * translator's draft preview. One implementation so the two can never disagree
 * about what a template looks like or where it lands.
 *
 * `assetPath` exists because the two callers read the asset through different
 * endpoints: a translator has no letterheads.view, so the portal serves its own
 * narrower route.
 */
export function TemplatePicker({
  kind,
  title,
  templates,
  loading,
  selectedId,
  onSelect,
  assetPath,
  emptyHint = true,
}: {
  kind: TemplateKind;
  title: string;
  templates: LetterheadTemplate[];
  loading: boolean;
  selectedId: number | null;
  onSelect: (id: number) => void;
  assetPath?: (id: number) => string;
  /** Links to the admin-only templates screen; hidden for translators. */
  emptyHint?: boolean;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground">القوالب الفعّالة فقط</span>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-[13px]">
          <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            لا توجد {kind === "stamp" ? "أختام" : "ترويسات"} فعّالة
            {emptyHint ? (
              <>
                {" — "}
                <Link href="/letterheads" className="font-medium text-primary hover:underline">
                  أضف قالباً من صفحة الترويسات والأختام
                </Link>
              </>
            ) : (
              " — راجع الإدارة."
            )}
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {templates.map((template) => {
            const selected = selectedId === template.id;
            return (
              <button
                key={template.id}
                type="button"
                onClick={() => onSelect(template.id)}
                className={cn(
                  "group relative overflow-hidden rounded-lg border bg-card text-start transition-all",
                  selected
                    ? "border-primary ring-2 ring-primary/30"
                    : "hover:border-primary/40 hover:shadow-sm",
                )}
              >
                <div
                  className={cn(
                    "flex h-24 items-center justify-center overflow-hidden border-b p-2",
                    kind === "stamp"
                      ? "bg-[repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] bg-[length:12px_12px]"
                      : "bg-muted/50",
                  )}
                >
                  <TemplateAsset template={template} assetPath={assetPath} />
                </div>
                <div className="p-2">
                  <p className="truncate text-xs font-medium">{template.name}</p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {PLACEMENT_PAGES_LABELS[template.placement.pages]} ·{" "}
                    {PLACEMENT_ANCHOR_LABELS[template.placement.anchor]}
                  </p>
                </div>
                {selected && (
                  <span className="absolute top-1.5 end-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                    <Check className="size-3" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
