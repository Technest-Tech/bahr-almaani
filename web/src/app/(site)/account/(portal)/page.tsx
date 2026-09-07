"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowLeft, FileText, Inbox } from "lucide-react";
import { clientApi } from "@/lib/client-auth";
import type { ClientOverview } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ProjectCard } from "@/components/account/project-card";
import { StatTile } from "@/components/account/stat-tile";

const numberFormatter = new Intl.NumberFormat("ar-EG");

const dateFormatter = new Intl.DateTimeFormat("ar-EG", { dateStyle: "long" });

export default function AccountOverviewPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["client-overview"],
    queryFn: () => clientApi<ClientOverview>("/client/overview"),
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  const { stats, recent_projects: recent } = data;
  const open = stats.by_stage.in_progress + stats.by_stage.in_review;

  return (
    <div className="space-y-8">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="إجمالي المشاريع"
          value={numberFormatter.format(stats.projects_total)}
          hint={open > 0 ? `${numberFormatter.format(open)} قيد العمل الآن` : "لا يوجد عمل جارٍ"}
        />
        {/* Pages first, then words — the same order the office quotes in. */}
        <StatTile
          label="إجمالي الصفحات"
          value={numberFormatter.format(stats.total_pages)}
          hint={`${numberFormatter.format(stats.total_words)} كلمة`}
        />
        <StatTile
          label="جاهز للاستلام"
          value={numberFormatter.format(stats.by_stage.ready)}
          hint={stats.by_stage.ready > 0 ? "ملفات معتمدة بانتظارك" : undefined}
        />
        <StatTile
          label="آخر تسليم"
          value={
            stats.last_delivery_at ? (
              <span className="text-lg">
                {dateFormatter.format(new Date(stats.last_delivery_at))}
              </span>
            ) : (
              "—"
            )
          }
        />
      </section>

      {stats.billing.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground">الفواتير</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {stats.billing.map((row) => (
              <StatTile
                key={row.currency}
                label={`إجمالي الفواتير (${row.currency})`}
                value={Number(row.amount).toLocaleString("ar-EG", {
                  minimumFractionDigits: 2,
                })}
                hint={`${numberFormatter.format(row.invoices)} فاتورة`}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">أحدث المشاريع</h2>
          {recent.length > 0 && (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/account/projects">
                عرض الكل
                <ArrowLeft className="size-4" />
              </Link>
            </Button>
          )}
        </div>

        {recent.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed px-6 py-12 text-center">
            <Inbox className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 font-medium">لا توجد مشاريع بعد</p>
            <p className="mt-1 text-sm text-muted-foreground">
              أرسل أول طلب وسيظهر هنا فور اعتماده.
            </p>
            <Button className="mt-5" asChild>
              <Link href="/request">
                <FileText className="size-4" />
                اطلب عرض سعر
              </Link>
            </Button>
          </div>
        ) : (
          <div className="mt-3 grid gap-3">
            {recent.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
