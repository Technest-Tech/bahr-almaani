"use client";

import { Progress as ProgressPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/**
 * Determinate progress bar.
 *
 * The indicator is sized rather than translated: `width` grows from the inline-start
 * edge, which is the right one in this RTL app. shadcn's stock `translateX(-N%)`
 * assumes LTR and fills the bar backwards under `dir="rtl"`.
 */
function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn("bg-primary/15 relative h-1.5 w-full overflow-hidden rounded-full", className)}
      value={value}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="bg-primary h-full rounded-full transition-[width] duration-200 ease-out"
        style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
