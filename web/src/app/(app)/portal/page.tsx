"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  FileSearch,
  FileText,
  Globe,
  Inbox,
  Paperclip,
  Search,
  Send,
  Stamp,
  Timer,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { isAbort, useFileTransfer } from "@/lib/use-transfer";
import { formatDuration, formatRelative, dateTimeFormatter } from "@/lib/format";
import {
  PRIORITY_LABELS,
  PRIORITY_TONES,
  STATUS_TONES,
  type Assignment,
  type Language,
  type Paginated,
  type Project,
  type ProjectFile,
  type StampPosition,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { ToneBadge } from "@/components/tone-badge";
import { useConfirm } from "@/components/confirm";
import { DraftPreviewDialog } from "@/components/portal/draft-preview-dialog";
import { DeliverDialog } from "@/components/portal/deliver-dialog";

const ALL = "all";

/** The PM's feedback for the current round, with anything they attached to it. */
interface RevisionNote {
  note: string;
  by: string;
  at: string;
  attachments?: ProjectFile[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface CurrentResponse {
  data: Assignment | null;
  revision_note?: RevisionNote | null;
}

export default function PortalPage() {
  const queryClient = useQueryClient();

  // Freshness comes from Reverb websockets (RealtimeProvider) — no polling.
  const { data: current, isLoading: loadingCurrent } = useQuery({
    queryKey: ["portal-current"],
    queryFn: () => api<CurrentResponse>("/portal/current"),
  });

  const busy = !!current?.data;

  // The queue carries every available file now, so filtering is how a translator
  // narrows it down — including back to their own registered pairs, on demand.
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState(ALL);
  const [serviceType, setServiceType] = useState(ALL);
  const [sourceLang, setSourceLang] = useState(ALL);
  const [targetLang, setTargetLang] = useState(ALL);
  const [myPairsOnly, setMyPairsOnly] = useState(false);

  const { data: languages } = useQuery({
    queryKey: ["languages"],
    queryFn: () => api<{ data: Language[] }>("/languages").then((r) => r.data),
    staleTime: 60 * 60 * 1000,
  });

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (priority !== ALL) params.set("priority", priority);
    if (serviceType !== ALL) params.set("service_type", serviceType);
    if (sourceLang !== ALL) params.set("source_language_id", sourceLang);
    if (targetLang !== ALL) params.set("target_language_id", targetLang);
    if (myPairsOnly) params.set("my_pairs", "1");
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }, [search, priority, serviceType, sourceLang, targetLang, myPairsOnly]);

  const filtersActive =
    !!search.trim() ||
    priority !== ALL ||
    serviceType !== ALL ||
    sourceLang !== ALL ||
    targetLang !== ALL ||
    myPairsOnly;

  const clearFilters = () => {
    setSearch("");
    setPriority(ALL);
    setServiceType(ALL);
    setSourceLang(ALL);
    setTargetLang(ALL);
    setMyPairsOnly(false);
  };

  const { data: queue, isLoading: loadingQueue } = useQuery({
    queryKey: ["portal-queue", queryString],
    queryFn: () => api<Paginated<Project>>(`/portal/queue${queryString}`),
    placeholderData: (previous) => previous,
  });

  const { data: history } = useQuery({
    queryKey: ["portal-history"],
    queryFn: () => api<Paginated<Assignment>>("/portal/history"),
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["portal-current"] });
    queryClient.invalidateQueries({ queryKey: ["portal-queue"] });
    queryClient.invalidateQueries({ queryKey: ["portal-history"] });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="بورتال المترجم"
        description="كل الملفات المنشورة متاحة للجميع — مرتبة تلقائياً: العاجل أولاً ثم الأقرب موعداً. استخدم الفلاتر للتصفية، وملف واحد قيد التنفيذ في كل وقت."
      />

      {loadingCurrent ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : current?.data ? (
        <CurrentAssignmentCard
          assignment={current.data}
          revisionNote={current.revision_note}
          onDelivered={invalidateAll}
        />
      ) : null}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Inbox className="size-4 text-primary" />
            الملفات المتاحة
            <span className="text-sm font-normal text-muted-foreground">
              ({queue?.meta.total ?? 0})
            </span>
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/40 p-2">
          <div className="relative min-w-52 max-w-xs flex-1">
            <Search className="absolute end-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="بحث بعنوان الملف أو رقمه…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-8 border-transparent bg-background pe-8 text-[13px] shadow-none focus-visible:border-ring"
            />
          </div>

          <Select value={sourceLang} onValueChange={setSourceLang}>
            <SelectTrigger size="sm" className="w-36 bg-background text-[13px]">
              <SelectValue placeholder="من لغة" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>كل اللغات (من)</SelectItem>
              {languages?.map((language) => (
                <SelectItem key={language.id} value={String(language.id)}>
                  {language.name_ar}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={targetLang} onValueChange={setTargetLang}>
            <SelectTrigger size="sm" className="w-36 bg-background text-[13px]">
              <SelectValue placeholder="إلى لغة" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>كل اللغات (إلى)</SelectItem>
              {languages?.map((language) => (
                <SelectItem key={language.id} value={String(language.id)}>
                  {language.name_ar}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger size="sm" className="w-32 bg-background text-[13px]">
              <SelectValue placeholder="الأولوية" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>كل الأولويات</SelectItem>
              <SelectItem value="normal">عادي</SelectItem>
              <SelectItem value="urgent">عاجل</SelectItem>
              <SelectItem value="critical">حرج</SelectItem>
            </SelectContent>
          </Select>

          <Select value={serviceType} onValueChange={setServiceType}>
            <SelectTrigger size="sm" className="w-32 bg-background text-[13px]">
              <SelectValue placeholder="نوع الخدمة" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>كل الأنواع</SelectItem>
              <SelectItem value="certified">ترجمة معتمدة</SelectItem>
              <SelectItem value="regular">ترجمة عادية</SelectItem>
            </SelectContent>
          </Select>

          <Button
            type="button"
            size="sm"
            variant={myPairsOnly ? "default" : "outline"}
            className="h-8 text-[13px]"
            onClick={() => setMyPairsOnly((on) => !on)}
            title="اعرض فقط الملفات ضمن أزواج لغاتك المسجلة"
          >
            <Globe className="size-3.5" />
            أزواج لغاتي
          </Button>

          {filtersActive && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 text-[13px] text-muted-foreground"
              onClick={clearFilters}
            >
              <X className="size-3.5" />
              مسح
            </Button>
          )}
        </div>

        {loadingQueue && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-44 rounded-xl" />
            ))}
          </div>
        )}

        {!loadingQueue && queue?.data.length === 0 && (
          <Card className="border-dashed bg-transparent py-10 shadow-none">
            <CardContent className="text-center text-sm text-muted-foreground">
              {filtersActive
                ? "لا توجد ملفات مطابقة لهذا البحث — جرّب توسيع الفلاتر أو امسحها."
                : "لا توجد ملفات متاحة حالياً — ستصلك إشعارات فور توفر ملفات جديدة."}
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {queue?.data.map((project) => (
            <QueueCard
              key={project.id}
              project={project}
              disabled={busy}
              onClaimed={invalidateAll}
            />
          ))}
        </div>
      </section>

      {!!history?.data.length && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <CheckCircle2 className="size-4 text-primary" />
            أعمالي السابقة
          </h2>
          <Card className="gap-0 py-0">
            <CardContent className="p-0">
              <ul className="divide-y">
                {history.data.map((assignment) => (
                  <li key={assignment.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {assignment.project?.title}
                      </p>
                      <p dir="ltr" className="text-start font-mono text-xs text-muted-foreground">
                        {assignment.project?.code}
                      </p>
                    </div>
                    {assignment.project && (
                      <ToneBadge tone={STATUS_TONES[assignment.project.status]}>
                        {assignment.project.status_label}
                      </ToneBadge>
                    )}
                    {assignment.status === "withdrawn" ? (
                      <ToneBadge tone="slate">مسحوب</ToneBadge>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Timer className="size-3.5" />
                        {formatDuration(assignment.work_seconds ?? 0)}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {assignment.delivered_at &&
                        dateTimeFormatter.format(new Date(assignment.delivered_at))}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}

function subscribeEveryMinute(callback: () => void) {
  const interval = setInterval(callback, 60_000);
  return () => clearInterval(interval);
}

function ElapsedTimer({ since }: { since: string }) {
  // Minute-floored snapshot: stable within each minute, pure during render.
  const seconds = useSyncExternalStore(
    subscribeEveryMinute,
    () => Math.floor(Math.max(0, Date.now() - new Date(since).getTime()) / 60_000) * 60,
    () => 0,
  );

  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-sm font-semibold text-primary">
      <Timer className="size-4" />
      {formatDuration(seconds)}
    </span>
  );
}

function CurrentAssignmentCard({
  assignment,
  revisionNote,
  onDelivered,
}: {
  assignment: Assignment;
  revisionNote?: RevisionNote | null;
  onDelivered: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  /** Files chosen but not yet handed over — the seal is positioned on these. */
  const [staged, setStaged] = useState<File[]>([]);
  const { confirm } = useConfirm();
  const { download, upload } = useFileTransfer();
  const [uploading, setUploading] = useState(false);
  const project = assignment.project!;

  /**
   * Picking files opens the delivery dialog rather than delivering outright: the
   * translator gets a chance to put the office seal where it actually fits before the
   * document leaves them. Confirmation lives in that dialog now.
   */
  function handleDeliver(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    if (picked.length === 0) return;

    setStaged(picked);
  }

  function cancelDelivery() {
    setStaged([]);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function submitDelivery(placements: Record<number, StampPosition>) {
    setUploading(true);

    // One delivery, however many documents — the merge letterheads each of them
    // into its own certified file, each with its own seal position.
    const formData = new FormData();
    staged.forEach((file) => formData.append("files[]", file));
    Object.entries(placements).forEach(([index, placement]) =>
      formData.append(`stamp_placements[${index}]`, JSON.stringify(placement)),
    );

    const label =
      staged.length === 1 ? staged[0].name : `${staged.length.toLocaleString("ar-EG")} ملفات`;

    try {
      await upload("/portal/deliver", formData, label);
      toast.success("تم تسليم الترجمة — شكراً لك 🎉");
      setStaged([]);
      onDelivered();
    } catch (err) {
      if (!isAbort(err)) {
        toast.error(err instanceof ApiError ? err.message : "فشل التسليم");
      }
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <Card className="gap-0 overflow-hidden border-primary/30 py-0 shadow-md shadow-primary/5">
      <CardHeader className="flex-row items-center justify-between border-b bg-primary/5 py-4!">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Clock className="size-4 text-primary" />
          ملفك الحالي
          <ToneBadge tone={PRIORITY_TONES[project.priority]}>
            {PRIORITY_LABELS[project.priority]}
          </ToneBadge>
          {revisionNote && <ToneBadge tone="red">مطلوب تعديل</ToneBadge>}
        </CardTitle>
        <ElapsedTimer since={assignment.claimed_at!} />
      </CardHeader>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">{project.title}</h3>
            <p dir="ltr" className="text-start font-mono text-xs text-muted-foreground">
              {project.code}
            </p>
          </div>
          <div className="text-end text-sm">
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <Globe className="size-3.5" />
              {project.source_language?.name_ar} ← {project.target_language?.name_ar}
            </p>
            <p
              className={`mt-1 flex items-center gap-1.5 text-xs ${
                project.is_late ? "font-semibold text-destructive" : "text-muted-foreground"
              }`}
            >
              {project.is_late && <AlertTriangle className="size-3.5" />}
              التسليم {formatRelative(project.deadline_at)} —{" "}
              {dateTimeFormatter.format(new Date(project.deadline_at))}
            </p>
          </div>
        </div>

        {revisionNote && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="mb-1 text-xs font-semibold text-destructive">
              ملاحظات المراجعة — {revisionNote.by}
            </p>
            <p className="whitespace-pre-wrap">{revisionNote.note}</p>

            {/* Only this round's attachments — the API scopes them to the transition. */}
            {!!revisionNote.attachments?.length && (
              <ul className="mt-3 space-y-1.5 border-t border-destructive/20 pt-2.5">
                {revisionNote.attachments.map((file) => (
                  <li key={file.id} className="flex items-center gap-2">
                    <Paperclip className="size-3.5 shrink-0 text-destructive/70" />
                    <span dir="ltr" className="min-w-0 flex-1 truncate text-start text-xs">
                      {file.original_name}
                    </span>
                    {/* bdi: the unit is Latin and the run is RTL — without it "666 B"
                        renders as "B 666". */}
                    <bdi className="shrink-0 text-[11px] text-muted-foreground">
                      {formatBytes(file.size_bytes)}
                    </bdi>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title="تحميل المرفق"
                      onClick={() =>
                        download(`/portal/files/${file.id}/download`, file.original_name).catch(
                          () => toast.error("تعذر تحميل المرفق"),
                        )
                      }
                    >
                      <Download className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {project.instructions && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
            <p className="mb-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
              تعليمات خاصة
            </p>
            {project.instructions}
          </div>
        )}

        {!!project.files?.length && (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">ملفات المشروع</p>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {project.files
                .filter((f) => f.category === "source" || f.category === "reference")
                .map((file) => (
                  <li
                    key={file.id}
                    className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2"
                  >
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span dir="ltr" className="min-w-0 flex-1 truncate text-start text-xs font-medium">
                      {file.original_name}
                    </span>
                    <ToneBadge tone={file.category === "source" ? "violet" : "slate"}>
                      {file.category === "source" ? "عمل" : "مرجع"}
                    </ToneBadge>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title="تحميل"
                      onClick={() =>
                        download(`/portal/files/${file.id}/download`, file.original_name)
                          .catch(() => toast.error("تعذر تحميل الملف"))
                      }
                    >
                      <Download className="size-3.5" />
                    </Button>
                  </li>
                ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <input ref={inputRef} type="file" hidden multiple onChange={handleDeliver} />
          {/* Before delivering, not after: the point is to fix the document while
              it is still yours to fix. */}
          <Button size="lg" variant="outline" onClick={() => setPreviewOpen(true)}>
            <FileSearch className="size-4" />
            معاينة بالترويسة والختم
          </Button>
          <Button size="lg" loading={uploading} onClick={() => inputRef.current?.click()}>
            <Send className="size-4" />
            {revisionNote ? "تسليم التعديل" : "تسليم الترجمة"}
          </Button>
        </div>

        <DraftPreviewDialog open={previewOpen} onClose={() => setPreviewOpen(false)} />

        <DeliverDialog
          open={staged.length > 0}
          files={staged}
          onCancel={cancelDelivery}
          onConfirm={submitDelivery}
          submitting={uploading}
        />
      </CardContent>
    </Card>
  );
}

function QueueCard({
  project,
  disabled,
  onClaimed,
}: {
  project: Project;
  disabled: boolean;
  onClaimed: () => void;
}) {
  const claimMutation = useMutation({
    mutationFn: () => api(`/portal/claim/${project.id}`, { method: "POST" }),
    onSuccess: () => {
      toast.success(`استلمت «${project.title}» — بالتوفيق 💪`);
      onClaimed();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "تعذر الاستلام");
      onClaimed(); // refresh — someone else likely took it
    },
  });

  return (
    <Card className="group flex flex-col gap-0 py-0 transition-all hover:-translate-y-0.5 hover:shadow-md">
      <CardContent className="flex-1 space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <ToneBadge tone={PRIORITY_TONES[project.priority]}>
            {PRIORITY_LABELS[project.priority]}
          </ToneBadge>
          <span
            className={`text-xs ${
              project.is_late ? "font-semibold text-destructive" : "text-muted-foreground"
            }`}
          >
            {formatRelative(project.deadline_at)}
          </span>
        </div>
        <div>
          <h3 className="font-semibold leading-snug">{project.title}</h3>
          <p dir="ltr" className="mt-0.5 text-start font-mono text-[11px] text-muted-foreground">
            {project.code}
          </p>
        </div>
        <div className="space-y-1 text-xs text-muted-foreground">
          <p className="flex items-center gap-1.5">
            <Globe className="size-3.5 shrink-0" />
            {project.source_language?.name_ar} ← {project.target_language?.name_ar}
          </p>
          <p className="flex items-center gap-1.5">
            <FileText className="size-3.5 shrink-0" />
            {project.total_words
              ? `${project.total_words.toLocaleString("ar-EG")} كلمة`
              : "عدد الكلمات غير محدد"}
            {project.total_pages ? ` · ${project.total_pages.toLocaleString("ar-EG")} صفحة` : ""}
          </p>
          <p className="flex items-center gap-1.5">
            <Stamp className="size-3.5 shrink-0" />
            {project.service_type === "certified" ? "ترجمة معتمدة" : "ترجمة عادية"}
            {project.country_code ? ` · ${project.country_code}` : ""}
          </p>
          {project.deadline_at && (
            <p className="flex items-center gap-1.5">
              <Clock className="size-3.5 shrink-0" />
              {dateTimeFormatter.format(new Date(project.deadline_at))}
            </p>
          )}
        </div>

        {!!project.files?.length && (
          <div className="space-y-1 rounded-lg bg-muted/50 p-2">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <Paperclip className="size-3 shrink-0" />
              الملفات ({project.files.length})
            </p>
            <ul className="space-y-0.5">
              {project.files.map((file) => (
                <li key={file.id} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="truncate" title={file.original_name}>
                    {file.original_name}
                  </span>
                  <span className="shrink-0 font-mono text-muted-foreground">
                    {formatBytes(file.size_bytes)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {project.instructions && (
          <p className="line-clamp-3 rounded-lg bg-amber-500/10 p-2 text-[11px] leading-relaxed text-foreground/80">
            {project.instructions}
          </p>
        )}
      </CardContent>
      <div className="border-t p-3">
        <Button
          className="w-full"
          size="sm"
          loading={claimMutation.isPending}
          disabled={disabled}
          title={disabled ? "سلّم ملفك الحالي أولاً" : undefined}
          onClick={() => claimMutation.mutate()}
        >
          استلام الملف
        </Button>
      </div>
    </Card>
  );
}
