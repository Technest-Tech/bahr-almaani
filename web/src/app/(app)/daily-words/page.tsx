"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Info, Target } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";

interface DayRow {
  date: string;
  delivered_words: number;
  declared_words: number | null;
  variance: number | null;
  files: number;
  note: string | null;
}

interface MonthResponse {
  month: string;
  days: DayRow[];
  summary: {
    delivered_words: number;
    declared_words: number;
    variance: number;
    monthly_target: number | null;
    achieved_pct: number | null;
    days_logged: number;
    days_delivered: number;
  };
  limits: {
    max_declared_words: number;
    earliest_date: string;
    latest_date: string;
  };
}

const WEEKDAY = new Intl.DateTimeFormat("ar-EG", { weekday: "long" });
const DAY_MONTH = new Intl.DateTimeFormat("ar-EG", { day: "2-digit", month: "2-digit" });
const MONTH_LABEL = new Intl.DateTimeFormat("ar-EG", { month: "long", year: "numeric" });

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(year, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function num(value: number): string {
  return value.toLocaleString("ar-EG");
}

/** A stat tile for the month summary strip. */
function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "positive" | "negative";
}) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="space-y-1 p-5">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={cn(
            "text-2xl font-semibold tabular-nums",
            tone === "positive" && "text-emerald-600 dark:text-emerald-400",
            tone === "negative" && "text-destructive",
          )}
        >
          {value}
        </p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/**
 * One editable day. Local state so typing never fights the query cache — the
 * parent remounts this via `key` when the saved row changes, which is how the
 * inputs pick up the server value (React 19 lints against syncing in an effect).
 */
function DayEditor({
  day,
  editable,
  max,
  onSave,
  saving,
}: {
  day: DayRow;
  editable: boolean;
  max: number;
  onSave: (words: string, note: string) => void;
  saving: boolean;
}) {
  const [words, setWords] = useState(() => day.declared_words?.toString() ?? "");
  const [note, setNote] = useState(() => day.note ?? "");

  const dirty = words !== (day.declared_words?.toString() ?? "") || note !== (day.note ?? "");

  function commit() {
    if (!dirty || words === "") return;
    onSave(words, note);
  }

  return (
    <>
      <TableCell className="w-40">
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          disabled={!editable || saving}
          value={words}
          placeholder={editable ? "—" : ""}
          onChange={(e) => setWords(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          className="h-9 tabular-nums"
        />
      </TableCell>
      <TableCell>
        <Input
          disabled={!editable || saving}
          value={note}
          placeholder={editable ? "ملاحظة (اختياري)" : ""}
          onChange={(e) => setNote(e.target.value)}
          onBlur={commit}
          className="h-9"
        />
      </TableCell>
    </>
  );
}

export default function DailyWordsPage() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(currentMonth());

  const { data, isLoading } = useQuery({
    queryKey: ["daily-words", month],
    queryFn: () => api<{ data: MonthResponse }>(`/portal/daily-words?month=${month}`).then((r) => r.data),
  });

  const save = useMutation({
    mutationFn: (payload: { work_date: string; declared_words: number; note: string | null }) =>
      api("/portal/daily-words", { method: "POST", json: payload }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["daily-words", month] }),
    onError: (err) =>
      toast.error(
        err instanceof ApiError && err.errors
          ? Object.values(err.errors)[0][0]
          : err instanceof Error
            ? err.message
            : "تعذر حفظ اليوم",
      ),
  });

  const summary = data?.summary;
  const monthLabel = MONTH_LABEL.format(new Date(`${month}-01T00:00:00`));

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="إنتاجي اليومي"
        description="سجّل عدد الكلمات التي أنجزتها كل يوم. الرقم الذي يحسبه النظام من تسليماتك يظهر بجانبه للمقارنة."
      >
        {/* RTL: time runs leftward, so the left chevron is the later month. */}
        <div className="flex items-center gap-1 rounded-lg border bg-background p-1">
          <Button variant="ghost" size="icon-xs" title="الشهر التالي" disabled={month >= currentMonth()} onClick={() => setMonth(shiftMonth(month, 1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-32 text-center text-sm font-medium">{monthLabel}</span>
          <Button variant="ghost" size="icon-xs" title="الشهر السابق" onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {isLoading || !summary ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
        ) : (
          <>
            <Stat
              label="كلمات مسلّمة (حساب النظام)"
              value={num(summary.delivered_words)}
              hint={`${num(summary.days_delivered)} يوم تسليم`}
            />
            <Stat
              label="كلمات أعلنتها"
              value={num(summary.declared_words)}
              hint={`${num(summary.days_logged)} يوم مسجّل`}
            />
            <Stat
              label="التارجت الشهري"
              value={summary.monthly_target ? num(summary.monthly_target) : "غير محدد"}
              hint={summary.monthly_target ? "من إدارة الشركة" : "لم تحدده الإدارة بعد"}
            />
            <Stat
              label="نسبة الإنجاز"
              value={summary.achieved_pct === null ? "—" : `${num(summary.achieved_pct)}٪`}
              tone={
                summary.achieved_pct === null
                  ? "default"
                  : summary.achieved_pct >= 100
                    ? "positive"
                    : "default"
              }
              hint="على أساس الكلمات المسلّمة"
            />
          </>
        )}
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <p className="text-muted-foreground">
          حساب النظام يقيّد كلمات الملف كلها في <strong className="text-foreground">يوم التسليم</strong>،
          فالملف الذي استلمته الاثنين وسلّمته الخميس تُحتسب كلماته يوم الخميس بالكامل. لهذا يوجد العمودان
          معًا — الفرق بينهما طبيعي، والرقم الذي تسجّله هو روايتك عن يومك.
        </p>
      </div>

      <Card className="gap-0 py-0">
        <CardHeader className="border-b py-4!">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Target className="size-4 text-muted-foreground" />
            أيام {monthLabel}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading || !data ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>اليوم</TableHead>
                  <TableHead>كلمات مسلّمة (النظام)</TableHead>
                  <TableHead>ما أعلنته</TableHead>
                  <TableHead>ملاحظة</TableHead>
                  <TableHead>الفرق</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.days.map((day) => {
                  const editable =
                    day.date >= data.limits.earliest_date && day.date <= data.limits.latest_date;
                  const date = new Date(`${day.date}T00:00:00`);
                  const weekend = [5, 6].includes(date.getDay());

                  return (
                    <TableRow key={day.date} className={cn(weekend && "bg-muted/40")}>
                      <TableCell className="whitespace-nowrap">
                        <span className="font-medium">{DAY_MONTH.format(date)}</span>
                        <span className="ms-2 text-xs text-muted-foreground">
                          {WEEKDAY.format(date)}
                        </span>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {day.delivered_words > 0 ? (
                          <>
                            {num(day.delivered_words)}
                            <span className="ms-2 text-xs text-muted-foreground">
                              ({num(day.files)} ملف)
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <DayEditor
                        key={`${day.date}:${day.declared_words}:${day.note}`}
                        day={day}
                        editable={editable}
                        max={data.limits.max_declared_words}
                        saving={save.isPending}
                        onSave={(words, note) =>
                          save.mutate({
                            work_date: day.date,
                            declared_words: Number(words),
                            note: note || null,
                          })
                        }
                      />
                      <TableCell className="tabular-nums">
                        {day.variance === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span
                            className={cn(
                              day.variance > 0 && "text-amber-600 dark:text-amber-400",
                              day.variance < 0 && "text-muted-foreground",
                            )}
                          >
                            {day.variance > 0 ? "+" : ""}
                            {num(day.variance)}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
