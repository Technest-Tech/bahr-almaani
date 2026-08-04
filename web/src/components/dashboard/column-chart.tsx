"use client";

import { useId, useState } from "react";

export interface ColumnDatum {
  label: string; // axis label (short)
  full: string; // tooltip label (verbose)
  value: number;
}

interface ColumnChartProps {
  title: string; // names the single series (no legend needed)
  data: ColumnDatum[]; // chronological
  tickEvery?: number; // draw an x label every N columns
  unit?: string; // tooltip unit suffix, e.g. "ملف" / "كلمة"
  emptyMessage: string;
}

/** Round the axis max up to a clean 1/2/5×10ⁿ step. */
function niceMax(max: number): number {
  if (max <= 4) return 4;
  const power = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 5, 10]) {
    if (max <= step * power) return step * power;
  }
  return 10 * power;
}

/**
 * Single-series column chart (marks: brand navy — chart slot 1, validated on
 * both surfaces;
 * ≤24px columns, 4px rounded data-end, 2px surface gaps, hairline grid).
 * Time flows left→right inside an LTR island; labels stay Arabic.
 */
export function ColumnChart({ title, data, tickEvery = 7, unit, emptyMessage }: ColumnChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const tableId = useId();
  const max = Math.max(...data.map((d) => d.value), 0);
  const top = niceMax(max);

  if (max === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div>
      <div dir="ltr" className="relative" role="img" aria-label={title} aria-describedby={tableId}>
        {/* hairline gridlines + y ticks (clean numbers, muted, on the reading side) */}
        <div className="absolute inset-x-0 top-0 h-40">
          {[1, 0.5].map((fraction) => (
            <div
              key={fraction}
              className="absolute inset-x-0 flex items-center"
              style={{ top: `${(1 - fraction) * 100}%` }}
            >
              <div className="h-px flex-1 bg-border/60" />
              <span className="ps-2 text-[10px] tabular-nums text-muted-foreground">
                {(top * fraction).toLocaleString("ar-EG")}
              </span>
            </div>
          ))}
        </div>

        {/* columns — the wrapper (not the painted mark) is the hit target */}
        <div className="relative flex h-40 items-end justify-around gap-[2px] pe-10">
          {data.map((datum, index) => (
            <button
              key={datum.full}
              type="button"
              tabIndex={0}
              aria-label={`${datum.full}: ${datum.value.toLocaleString("ar-EG")}${unit ? ` ${unit}` : ""}`}
              onPointerEnter={() => setActive(index)}
              onPointerLeave={() => setActive((current) => (current === index ? null : current))}
              onFocus={() => setActive(index)}
              onBlur={() => setActive((current) => (current === index ? null : current))}
              className="group relative flex h-full max-w-6 flex-1 cursor-default items-end rounded-t focus:outline-none focus-visible:bg-muted/60"
            >
              <span
                className={`block w-full rounded-t-[4px] transition-colors ${
                  active === index
                    ? "bg-navy-800 dark:bg-navy-300"
                    : "bg-chart-1"
                }`}
                style={{ height: `${(datum.value / top) * 100}%` }}
              />
            </button>
          ))}

          {/* one tooltip, positioned over the active column */}
          {active !== null && (
            <div
              dir="rtl"
              className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
              style={{ left: `${((active + 0.5) / data.length) * 100}%` }}
            >
              <span className="font-semibold tabular-nums">
                {data[active].value.toLocaleString("ar-EG")}
                {unit ? ` ${unit}` : ""}
              </span>
              <span className="ms-2 text-muted-foreground">{data[active].full}</span>
            </div>
          )}
        </div>

        {/* baseline + sparse x labels */}
        <div className="mt-1 border-t pe-10">
          <div className="flex justify-around gap-[2px]">
            {data.map((datum, index) => (
              <span
                key={datum.full}
                className="max-w-6 flex-1 pt-1 text-center text-[10px] text-muted-foreground"
              >
                {index % tickEvery === 0 ? datum.label : ""}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* table view: same data, reachable without hovering.
          sr-only must sit on a wrapping div, not the table: on a table box the
          1px height is a *minimum* and overflow:hidden does not clip, so the
          absolutely-positioned table keeps its full size and stretches the
          page's scroll height by hundreds of blank pixels. */}
      <div className="sr-only">
        <table id={tableId}>
          <caption>{title}</caption>
          <thead>
            <tr>
              <th scope="col">الفترة</th>
              <th scope="col">القيمة</th>
            </tr>
          </thead>
          <tbody>
            {data.map((datum) => (
              <tr key={datum.full}>
                <td>{datum.full}</td>
                <td>{datum.value.toLocaleString("ar-EG")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
