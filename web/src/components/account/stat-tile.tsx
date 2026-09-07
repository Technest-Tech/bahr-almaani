import { cn } from "@/lib/utils";

/** One number with its label — the client area's unit of summary. */
export function StatTile({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border bg-card px-4 py-3.5", className)}>
      <p className="text-[12.5px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
