"use client";

import { Flame, Timer, Zap } from "lucide-react";
import type { Priority } from "@/lib/types";
import { cn } from "@/lib/utils";

const PRIORITIES: { value: Priority; label: string; hint: string; icon: typeof Timer }[] = [
  { value: "normal", label: "عادي", hint: "الجدول المعتاد", icon: Timer },
  { value: "urgent", label: "عاجل", hint: "أولوية على الطابور", icon: Zap },
  { value: "critical", label: "حرج", hint: "أسرع تنفيذ ممكن", icon: Flame },
];

/** The three priorities as cards — the website's forms, where a bare select reads as fine print. */
export function PriorityPicker({
  value,
  onChange,
}: {
  value: Priority;
  onChange: (value: Priority) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {PRIORITIES.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex items-start gap-3 rounded-xl border p-4 text-start transition-all",
              active
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : "hover:border-primary/40 hover:bg-accent/50",
            )}
          >
            <span
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg",
                active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              <option.icon className="size-4" />
            </span>
            <span className="grid gap-0.5">
              <span className="text-sm font-semibold">{option.label}</span>
              <span className="text-xs text-muted-foreground">{option.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
