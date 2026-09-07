"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import {
  ArrowRight,
  Download,
  FileCheck2,
  FileUp,
  Package,
} from "lucide-react";
import { toast } from "sonner";
import { downloadFile } from "@/lib/api";
import { clientApi } from "@/lib/client-auth";
import {
  CLIENT_STAGE_TONES,
  PRIORITY_LABELS,
  type ClientProject,
  type ClientProjectFile,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToneBadge } from "@/components/tone-badge";

const dateFormatter = new Intl.DateTimeFormat("ar-EG", { dateStyle: "long" });

const numberFormatter = new Intl.NumberFormat("ar-EG");

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} كيلوبايت`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} ميجابايت`;
}

export default function AccountProjectPage() {
  const id = useParams<{ id: string }>().id;
  const [busy, setBusy] = useState<string | null>(null);

  const { data: project, isLoading } = useQuery({
    queryKey: ["client-project", id],
    queryFn: () =>
      clientApi<{ data: ClientProject }>(`/client/projects/${id}`).then((r) => r.data),
  });

  // Downloads carry a bearer token, so they cannot be plain <a href> links.
  async function download(path: string, filename: string, key: string) {
    setBusy(key);
    try {
      await downloadFile(path, filename, { realm: "client" });
    } catch {
      toast.error("تعذر تحميل الملف. حاول مرة أخرى.");
    } finally {
      setBusy(null);
    }
  }

  if (isLoading || !project) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-52 rounded-xl" />
      </div>
    );
  }

  const finals = (project.files ?? []).filter((file) => file.category === "final");
  const sources = (project.files ?? []).filter((file) => file.category === "source");

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ms-2">
        <Link href="/account/projects">
          <ArrowRight className="size-4" />
          كل المشاريع
        </Link>
      </Button>

      <Card className="overflow-hidden py-0">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b bg-muted/40 px-6 py-5">
            <div className="min-w-0">
              <p className="font-mono text-sm text-muted-foreground" dir="ltr">
                {project.code}
              </p>
              <h2 className="mt-1 truncate text-xl font-semibold">{project.title}</h2>
            </div>
            <ToneBadge
              tone={CLIENT_STAGE_TONES[project.stage]}
              className="px-3 py-1 text-[13px]"
            >
              {project.stage_label}
            </ToneBadge>
          </div>

          <div className="px-6 py-5">
            <p className="text-sm leading-relaxed text-muted-foreground">{project.stage_hint}</p>
          </div>

          <dl className="divide-y border-t text-sm">
            {project.source_language && project.target_language && (
              <Row label="زوج اللغات">
                {project.source_language.name_ar} ← {project.target_language.name_ar}
              </Row>
            )}
            <Row label="نوع الخدمة">
              {project.service_type === "certified" ? "ترجمة معتمدة" : "ترجمة عادية"}
            </Row>
            <Row label="الأولوية">{PRIORITY_LABELS[project.priority]}</Row>
            {project.pages !== null && (
              <Row
                label="عدد الصفحات"
                hint={project.is_delivered_basis ? "من الملف المعتمد" : "تقديري من المصدر"}
              >
                {numberFormatter.format(project.pages)}
              </Row>
            )}
            {project.words !== null && project.words > 0 && (
              <Row label="عدد الكلمات">{numberFormatter.format(project.words)}</Row>
            )}
            {project.deadline_at && (
              <Row label="موعد التسليم">
                {dateFormatter.format(new Date(project.deadline_at))}
              </Row>
            )}
            {project.completed_at && (
              <Row label="تاريخ الإنجاز">
                {dateFormatter.format(new Date(project.completed_at))}
              </Row>
            )}
            {project.quoted_amount && (
              <Row label="التكلفة">
                {Number(project.quoted_amount).toLocaleString("ar-EG", {
                  minimumFractionDigits: 2,
                })}{" "}
                {project.currency}
              </Row>
            )}
            {project.invoice_number && (
              <Row label="رقم الفاتورة">
                <span dir="ltr" className="font-mono">
                  {project.invoice_number}
                </span>
              </Row>
            )}
          </dl>
        </CardContent>
      </Card>

      <FileGroup
        title="الملفات المعتمدة"
        icon={FileCheck2}
        emptyText="ستظهر الملفات المعتمدة هنا فور اعتمادها."
        files={finals}
        busy={busy}
        onDownload={(file) =>
          download(
            `/client/projects/${project.id}/files/${file.id}/download`,
            file.original_name,
            `file-${file.id}`,
          )
        }
        action={
          finals.length > 1 ? (
            <Button
              size="sm"
              variant="outline"
              loading={busy === "archive"}
              onClick={() =>
                download(
                  `/client/projects/${project.id}/final-files`,
                  `${project.code}-final.zip`,
                  "archive",
                )
              }
            >
              <Package className="size-4" />
              تحميل الكل
            </Button>
          ) : null
        }
      />

      <FileGroup
        title="الملفات المرسلة"
        icon={FileUp}
        emptyText="لا توجد ملفات مصدر مسجلة على هذا المشروع."
        files={sources}
        busy={busy}
        onDownload={(file) =>
          download(
            `/client/projects/${project.id}/files/${file.id}/download`,
            file.original_name,
            `file-${file.id}`,
          )
        }
      />
    </div>
  );
}

function FileGroup({
  title,
  icon: Icon,
  emptyText,
  files,
  busy,
  onDownload,
  action,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  emptyText: string;
  files: ClientProjectFile[];
  busy: string | null;
  onDownload: (file: ClientProjectFile) => void;
  action?: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Icon className="size-4" />
          {title}
        </h2>
        {action}
      </div>

      {files.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          {emptyText}
        </p>
      ) : (
        <ul className="mt-3 divide-y rounded-xl border bg-card">
          {files.map((file) => (
            <li key={file.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium">{file.original_name}</p>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {formatSize(file.size_bytes)}
                  {file.page_count ? ` · ${numberFormatter.format(file.page_count)} صفحة` : ""}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                loading={busy === `file-${file.id}`}
                onClick={() => onDownload(file)}
              >
                <Download className="size-4" />
                تحميل
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap justify-between gap-3 px-6 py-3.5">
      <dt className="text-muted-foreground">
        {label}
        {hint && <span className="ms-1.5 text-[11.5px] opacity-70">({hint})</span>}
      </dt>
      <dd className="text-end font-medium">{children}</dd>
    </div>
  );
}
