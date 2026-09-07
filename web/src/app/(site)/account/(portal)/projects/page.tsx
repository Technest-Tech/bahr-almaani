"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { FileText, Inbox } from "lucide-react";
import { clientApi } from "@/lib/client-auth";
import {
  CLIENT_STAGE_LABELS,
  type ClientProject,
  type ClientStage,
  type Paginated,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ProjectCard } from "@/components/account/project-card";
import { cn } from "@/lib/utils";

const STAGES: (ClientStage | "all")[] = [
  "all",
  "in_progress",
  "in_review",
  "ready",
  "completed",
  "cancelled",
];

export default function AccountProjectsPage() {
  const [stage, setStage] = useState<ClientStage | "all">("all");
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page) });
  if (stage !== "all") params.set("stage", stage);

  const { data, isLoading } = useQuery({
    queryKey: ["client-projects", stage, page],
    queryFn: () => clientApi<Paginated<ClientProject>>(`/client/projects?${params.toString()}`),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5">
        {STAGES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setStage(value);
              setPage(1);
            }}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors",
              stage === value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {value === "all" ? "الكل" : CLIENT_STAGE_LABELS[value]}
          </button>
        ))}
      </div>

      {isLoading && !data && (
        <div className="grid gap-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-28 rounded-xl" />
          ))}
        </div>
      )}

      {data && data.data.length === 0 && (
        <div className="rounded-xl border border-dashed px-6 py-12 text-center">
          <Inbox className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 font-medium">
            {stage === "all" ? "لا توجد مشاريع بعد" : "لا توجد مشاريع في هذه المرحلة"}
          </p>
          {stage === "all" && (
            <Button className="mt-5" asChild>
              <Link href="/request">
                <FileText className="size-4" />
                اطلب عرض سعر
              </Link>
            </Button>
          )}
        </div>
      )}

      {data && data.data.length > 0 && (
        <div className="grid gap-3">
          {data.data.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}

      {data && data.meta.last_page > 1 && (
        <div className="flex items-center justify-between gap-3 pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            السابق
          </Button>
          <span className="text-[13px] text-muted-foreground">
            صفحة {data.meta.current_page.toLocaleString("ar-EG")} من{" "}
            {data.meta.last_page.toLocaleString("ar-EG")}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= data.meta.last_page}
            onClick={() => setPage((current) => current + 1)}
          >
            التالي
          </Button>
        </div>
      )}
    </div>
  );
}
