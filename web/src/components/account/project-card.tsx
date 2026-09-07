import Link from "next/link";
import { ArrowLeft, CalendarClock, FileCheck2 } from "lucide-react";
import { CLIENT_STAGE_TONES, type ClientProject } from "@/lib/types";
import { ToneBadge } from "@/components/tone-badge";

const dateFormatter = new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium" });

const numberFormatter = new Intl.NumberFormat("ar-EG");

export function ProjectCard({ project }: { project: ClientProject }) {
  return (
    <Link
      href={`/account/projects/${project.id}`}
      className="group block rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11.5px] text-muted-foreground" dir="ltr">
            {project.code}
          </p>
          <p className="mt-0.5 truncate font-semibold">{project.title}</p>
        </div>
        <ToneBadge tone={CLIENT_STAGE_TONES[project.stage]}>{project.stage_label}</ToneBadge>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-muted-foreground">
        {project.source_language && project.target_language && (
          <span>
            {project.source_language.name_ar} ← {project.target_language.name_ar}
          </span>
        )}
        {/* Pages first — the unit the office quotes and bills in. */}
        {project.pages !== null && (
          <span className="tabular-nums">{numberFormatter.format(project.pages)} صفحة</span>
        )}
        {project.words !== null && project.words > 0 && (
          <span className="tabular-nums">{numberFormatter.format(project.words)} كلمة</span>
        )}
        {project.deadline_at && (
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="size-3.5" />
            {dateFormatter.format(new Date(project.deadline_at))}
          </span>
        )}
        {project.has_final_file && (
          <span className="inline-flex items-center gap-1 font-medium text-primary">
            <FileCheck2 className="size-3.5" />
            ملفات جاهزة
          </span>
        )}
        <ArrowLeft className="ms-auto size-4 transition-transform group-hover:-translate-x-0.5" />
      </div>
    </Link>
  );
}
