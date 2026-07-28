import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface StatTileProps {
  label: string;
  value: number | undefined;
  icon: LucideIcon;
  chip: string; // color classes for the icon chip
  sub?: string; // optional secondary line under the value
  loading?: boolean;
}

/** KPI stat tile: label + big proportional figure (+ optional sub-line). */
export function StatTile({ label, value, icon: Icon, chip, sub, loading }: StatTileProps) {
  return (
    <Card className="group gap-0 py-5 transition-all hover:-translate-y-0.5 hover:shadow-md">
      <CardContent className="px-5">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="text-[13px] text-muted-foreground">{label}</p>
            {loading ? (
              <Skeleton className="mt-3 h-8 w-16" />
            ) : (
              <p className="mt-2 text-3xl font-semibold tracking-tight">
                {(value ?? 0).toLocaleString("ar-EG")}
              </p>
            )}
            {sub && !loading && (
              <p className="mt-1 truncate text-xs text-muted-foreground">{sub}</p>
            )}
          </div>
          <div
            className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${chip} transition-transform group-hover:scale-110`}
          >
            <Icon className="size-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
