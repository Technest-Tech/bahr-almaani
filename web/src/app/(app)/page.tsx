"use client";

import { CheckCircle2, Clock, FileWarning, FolderKanban } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";

const PLACEHOLDER_STATS = [
  { label: "مشاريع جارية", icon: FolderKanban, chip: "bg-primary/10 text-primary" },
  { label: "بانتظار المراجعة", icon: Clock, chip: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  { label: "مشاريع متأخرة", icon: FileWarning, chip: "bg-destructive/10 text-destructive" },
  {
    label: "مكتملة هذا الشهر",
    icon: CheckCircle2,
    chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
];

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">
          أهلاً، {user?.name?.split(" ")[0]} 👋
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          هذه لوحة التحكم الرئيسية — ستُفعّل المؤشرات الحية مع وحدة الإحصائيات في Sprint 4.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PLACEHOLDER_STATS.map((stat) => (
          <Card key={stat.label} className="py-5">
            <CardContent className="flex items-center gap-4 px-5">
              <div className={`flex size-11 items-center justify-center rounded-xl ${stat.chip}`}>
                <stat.icon className="size-5" />
              </div>
              <div>
                <p className="text-2xl font-bold text-muted-foreground/40">—</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-dashed py-10">
        <CardContent className="text-center text-sm text-muted-foreground">
          بورتال المترجم والتحديثات اللحظية قيد التطوير — Sprint 3
        </CardContent>
      </Card>
    </div>
  );
}
