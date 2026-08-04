"use client";

import { defaultFilter } from "cmdk";
import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface ComboboxOption {
  value: string;
  label: string;
  hint?: string;
  /** Extra terms the search should match (e.g. an English name). */
  keywords?: string[];
}

interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  clearable?: boolean;
  id?: string;
}

/**
 * cmdk scores fuzzily, so a short exact term (an ISO country code, say) can rank
 * below long labels that merely contain those letters. Score an exact keyword hit
 * as a perfect match; everything else keeps cmdk's default scoring.
 */
const filterWithExactKeywords = (value: string, search: string, keywords?: string[]) => {
  const term = search.trim().toLowerCase();
  if (term && keywords?.some((keyword) => keyword.toLowerCase() === term)) return 1;
  return defaultFilter(value, search, keywords);
};

export function Combobox({
  options,
  value,
  onChange,
  placeholder = "اختر…",
  searchPlaceholder = "بحث…",
  emptyText = "لا توجد نتائج",
  disabled,
  clearable,
  id,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal",
            !selected && "text-muted-foreground",
          )}
        >
          <span className="truncate">{selected?.label ?? placeholder}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command filter={filterWithExactKeywords}>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {clearable && value && (
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    onChange("");
                    setOpen(false);
                  }}
                  className="text-muted-foreground"
                >
                  — بدون —
                </CommandItem>
              )}
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.hint ?? ""}`}
                  keywords={option.keywords}
                  onSelect={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "size-4",
                      option.value === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="flex-1 truncate">{option.label}</span>
                  {option.hint && (
                    <span className="text-xs text-muted-foreground">{option.hint}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
