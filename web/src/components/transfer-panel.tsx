"use client";

import { CheckCircle2, Download, Upload, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatBytes, formatEta, formatSpeed } from "@/lib/format";
import { type Transfer, useTransfers } from "@/lib/transfers";
import { cn } from "@/lib/utils";

/**
 * The floating register of in-flight uploads and downloads.
 *
 * Anchored bottom-start, above the toaster (which sits bottom-left at z-index 100
 * and would otherwise cover it). Renders nothing when idle, so it costs no space
 * on a screen where nothing is moving.
 */
export function TransferPanel() {
  const { transfers, dismiss, clearFinished } = useTransfers();

  if (transfers.length === 0) return null;

  const active = transfers.filter((transfer) => transfer.status === "active").length;

  return (
    <div
      dir="rtl"
      role="status"
      aria-live="polite"
      className="fixed bottom-4 start-4 z-[101] w-[min(22rem,calc(100vw-2rem))]"
    >
      <div className="bg-card overflow-hidden rounded-xl border shadow-lg">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <p className="text-sm font-medium">
            {active > 0 ? `جارٍ نقل ${active.toLocaleString("ar-EG")} ملف` : "اكتمل النقل"}
          </p>
          <Button
            variant="ghost"
            size="icon-sm"
            title="إخفاء المكتمل"
            onClick={clearFinished}
            className="text-muted-foreground"
          >
            <X className="size-4" />
          </Button>
        </div>

        <ul className="divide-y">
          {transfers.map((transfer) => (
            <TransferRow key={transfer.id} transfer={transfer} onDismiss={() => dismiss(transfer.id)} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function TransferRow({ transfer, onDismiss }: { transfer: Transfer; onDismiss: () => void }) {
  const { kind, name, loaded, total, status, speed, eta, error } = transfer;

  // Without a Content-Length there is no honest percentage — the bar goes
  // indeterminate rather than inventing one.
  const percent = total && total > 0 ? Math.min(100, (loaded / total) * 100) : null;

  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-2.5">
        <StatusIcon kind={kind} status={status} />
        <p dir="ltr" className="min-w-0 flex-1 truncate text-start text-xs font-medium">
          {name}
        </p>
        {status === "active" && transfer.cancel && (
          <Button
            variant="ghost"
            size="icon-sm"
            title="إلغاء"
            className="text-muted-foreground hover:text-destructive size-6"
            onClick={transfer.cancel}
          >
            <X className="size-3.5" />
          </Button>
        )}
        {status !== "active" && (
          <Button
            variant="ghost"
            size="icon-sm"
            title="إزالة"
            className="text-muted-foreground size-6"
            onClick={onDismiss}
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>

      {status === "active" && (
        <>
          <Progress
            value={percent ?? undefined}
            className={cn("mt-2", percent === null && "animate-pulse")}
          />
          {/*
            Every figure sits in its own isolated span. All of them mix Latin digits
            with Arabic words, and left in one text run the bidi algorithm reorders
            across the boundaries — the percentage came out as "٨١٪" for 18%.
          */}
          <div className="text-muted-foreground mt-1.5 flex items-center justify-between gap-2 text-[11px]">
            <span className="flex items-center gap-1.5">
              {percent !== null && (
                <bdi className="text-foreground font-medium">{`${Math.round(percent)}%`}</bdi>
              )}
              <bdi>
                {formatBytes(loaded)}
                {total ? ` من ${formatBytes(total)}` : ""}
              </bdi>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {speed && <bdi>{formatSpeed(speed)}</bdi>}
              {speed && eta ? <span aria-hidden>·</span> : null}
              {eta ? <bdi>{formatEta(eta)}</bdi> : null}
            </span>
          </div>
        </>
      )}

      {status === "done" && (
        <p className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-500">
          {kind === "upload" ? "تم الرفع" : "تم التحميل"} · <bdi>{formatBytes(loaded)}</bdi>
        </p>
      )}

      {status === "error" && (
        <p className="text-destructive mt-1 text-[11px]">{error ?? "فشل النقل"}</p>
      )}

      {status === "cancelled" && (
        <p className="text-muted-foreground mt-1 text-[11px]">أُلغي</p>
      )}
    </li>
  );
}

function StatusIcon({ kind, status }: { kind: Transfer["kind"]; status: Transfer["status"] }) {
  if (status === "done")
    return <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-500" />;
  if (status === "error") return <XCircle className="text-destructive size-4 shrink-0" />;

  const Icon = kind === "upload" ? Upload : Download;
  return (
    <Icon
      className={cn(
        "text-muted-foreground size-4 shrink-0",
        status === "active" && "text-primary animate-pulse",
      )}
    />
  );
}
