"use client";

import { CheckCircle2, Clock, FileWarning, FolderKanban } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";

const PLACEHOLDER_STATS = [
  { label: "مشاريع جارية", icon: FolderKanban, tone: "text-teal-700 bg-teal-50" },
  { label: "بانتظار المراجعة", icon: Clock, tone: "text-blue-700 bg-blue-50" },
  { label: "مشاريع متأخرة", icon: FileWarning, tone: "text-red-700 bg-red-50" },
  { label: "مكتملة هذا الشهر", icon: CheckCircle2, tone: "text-emerald-700 bg-emerald-50" },
];

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">
          أهلاً، {user?.name?.split(" ")[0]} 👋
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          هذه لوحة التحكم الرئيسية — ستُفعّل المؤشرات الحية مع وحدة المشاريع.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PLACEHOLDER_STATS.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="flex items-center gap-4">
              <div className={`flex size-11 items-center justify-center rounded-xl ${stat.tone}`}>
                <stat.icon className="size-5" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-300">—</p>
                <p className="text-xs text-slate-500">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-6 border-dashed">
        <CardContent className="py-10 text-center text-sm text-slate-400">
          وحدة المشاريع وبورتال المترجم قيد التطوير — Sprint 2 و 3
        </CardContent>
      </Card>
    </div>
  );
}
