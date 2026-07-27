"use client";

import { format } from "date-fns";
import { ar } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface DateTimePickerProps {
  /** ISO string or empty */
  value: string;
  onChange: (iso: string) => void;
  id?: string;
  disabled?: boolean;
}

export function DateTimePicker({ value, onChange, id, disabled }: DateTimePickerProps) {
  const [open, setOpen] = useState(false);
  const date = value ? new Date(value) : undefined;

  function apply(nextDate: Date | undefined, time?: string) {
    if (!nextDate) {
      onChange("");
      return;
    }
    const merged = new Date(nextDate);
    const [hours, minutes] = (
      time ??
      (date ? format(date, "HH:mm") : "17:00")
    ).split(":");
    merged.setHours(Number(hours || 0), Number(minutes || 0), 0, 0);
    onChange(merged.toISOString());
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start font-normal",
            !date && "text-muted-foreground",
          )}
        >
          <CalendarIcon className="size-4" />
          {date
            ? format(date, "d MMMM yyyy — HH:mm", { locale: ar })
            : "اختر التاريخ والوقت…"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={ar}
          dir="rtl"
          selected={date}
          onSelect={(selected) => apply(selected ?? undefined)}
          disabled={{ before: new Date() }}
          autoFocus
        />
        <div className="flex items-center gap-2 border-t p-3">
          <Label htmlFor={`${id}-time`} className="shrink-0 text-xs text-muted-foreground">
            الوقت
          </Label>
          <Input
            id={`${id}-time`}
            type="time"
            dir="ltr"
            className="h-8"
            value={date ? format(date, "HH:mm") : "17:00"}
            onChange={(event) => apply(date ?? new Date(), event.target.value)}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
