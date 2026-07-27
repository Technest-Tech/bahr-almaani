"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, Plus, Search } from "lucide-react";
import { api } from "@/lib/api";
import {
  PRIORITY_LABELS,
  PRIORITY_TONES,
  STATUS_TONES,
  type Paginated,
  type Project,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";

const dateFormatter = new Intl.DateTimeFormat("ar-EG", {
  dateStyle: "medium",
  timeStyle: "short",
});

const STATUS_OPTIONS = [
  ["draft", "مسودة"],
  ["available", "متاح"],
  ["claimed", "قيد التنفيذ"],
  ["delivered", "تم التسليم"],
  ["in_review", "قيد المراجعة"],
  ["revision_requested", "مطلوب تعديل"],
  ["approved", "معتمد"],
  ["completed", "مكتمل"],
  ["cancelled", "ملغي"],
] as const;

export default function ProjectsPage() {
  const { can } = useAuth();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [lateOnly, setLateOnly] = useState(false);
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page) });
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  if (priority) params.set("priority", priority);
  if (lateOnly) params.set("late", "1");

  const { data, isLoading } = useQuery({
    queryKey: ["projects", q, status, priority, lateOnly, page],
    queryFn: () => api<Paginated<Project>>(`/projects?${params.toString()}`),
  });

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">المشاريع</h1>
          <p className="mt-1 text-sm text-slate-500">رحلة الملف من الاستلام إلى التسليم</p>
        </div>
        {can("projects.manage") && (
          <Link href="/projects/new">
            <Button>
              <Plus className="size-4" />
              مشروع جديد
            </Button>
          </Link>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-64 flex-1">
          <Search className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="بحث بالعنوان أو الكود…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            className="pe-9"
          />
        </div>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-44">
          <option value="">كل الحالات</option>
          {STATUS_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
        <Select value={priority} onChange={(e) => { setPriority(e.target.value); setPage(1); }} className="w-36">
          <option value="">كل الأولويات</option>
          <option value="normal">عادي</option>
          <option value="urgent">عاجل</option>
          <option value="critical">حرج</option>
        </Select>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={lateOnly}
            onChange={(e) => { setLateOnly(e.target.checked); setPage(1); }}
            className="size-4 accent-red-600"
          />
          المتأخرة فقط
        </label>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-xs text-slate-500">
                <th className="px-4 py-3 text-start font-medium">المشروع</th>
                <th className="px-4 py-3 text-start font-medium">العميل</th>
                <th className="px-4 py-3 text-start font-medium">اللغات</th>
                <th className="px-4 py-3 text-start font-medium">الأولوية</th>
                <th className="px-4 py-3 text-start font-medium">الحالة</th>
                <th className="px-4 py-3 text-start font-medium">الكلمات / الصفحات</th>
                <th className="px-4 py-3 text-start font-medium">موعد التسليم</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400">جارِ التحميل…</td></tr>
              )}
              {!isLoading && data?.data.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400">لا توجد مشاريع مطابقة</td></tr>
              )}
              {data?.data.map((project) => (
                <tr key={project.id} className="border-b border-slate-50 hover:bg-slate-50/40">
                  <td className="px-4 py-3">
                    <Link href={`/projects/${project.id}`} className="group">
                      <p className="font-medium text-slate-800 group-hover:text-teal-700">
                        {project.title}
                      </p>
                      <p dir="ltr" className="text-start font-mono text-xs text-slate-400">
                        {project.code}
                      </p>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{project.client?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {project.source_language?.name_ar} ← {project.target_language?.name_ar}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={PRIORITY_TONES[project.priority]}>
                      {PRIORITY_LABELS[project.priority]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONES[project.status]}>{project.status_label}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {project.total_words ?? "—"} / {project.total_pages ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-xs">
                      {project.is_late && <AlertTriangle className="size-3.5 text-red-500" />}
                      <span className={project.is_late ? "font-medium text-red-600" : "text-slate-500"}>
                        {dateFormatter.format(new Date(project.deadline_at))}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data && data.meta.last_page > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
            <p className="text-xs text-slate-500">
              {data.meta.total} مشروع — صفحة {data.meta.current_page} من {data.meta.last_page}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                السابق
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.meta.last_page}
                onClick={() => setPage((p) => p + 1)}
              >
                التالي
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
