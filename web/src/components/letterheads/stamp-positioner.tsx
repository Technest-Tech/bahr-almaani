"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StampPosition } from "@/lib/types";

/** How far one arrow-key press moves the seal, in millimetres. */
const NUDGE_MM = 1;

/** …and with shift held, for crossing the page rather than tuning a corner. */
const NUDGE_COARSE_MM = 10;

export interface StampSurface {
  /** data: URI of the converted, letterheaded page the seal is placed on. */
  image: string;
  width_mm: number;
  height_mm: number;
  page: number;
  pages: number;
}

/**
 * Drag the office seal onto the blank space of a real page.
 *
 * The surface is the page the merge will actually produce — converted, letterheaded
 * and repaginated (App\Services\DocumentMergeService::stampSurface) — because a
 * position is only meaningful against the geometry the certified PDF will have. The
 * seal is drawn here at its true physical size relative to the sheet, so what the
 * translator lines up by eye is what comes out of the merge.
 *
 * The value is always expressed from the page's **top-left corner in millimetres**,
 * matching App\Support\PlacementConfig: physical paper geometry, never RTL-relative.
 * That is why the surface is forced `dir="ltr"` even in an Arabic interface — "left"
 * here means the left edge of the paper, not the start of the text.
 */
export function StampPositioner({
  surface,
  stampSrc,
  stampWidthMm,
  value,
  onChange,
  disabled = false,
}: {
  surface: StampSurface;
  stampSrc: string;
  /** The seal's true width on paper — from the stamp template, never guessed. */
  stampWidthMm: number;
  value: StampPosition | null;
  onChange: (next: StampPosition) => void;
  disabled?: boolean;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const stampRef = useRef<HTMLImageElement>(null);
  /** Where inside the seal the pointer took hold, in mm — so it does not jump. */
  const grabRef = useRef({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [stampRatio, setStampRatio] = useState<number | null>(null);

  const stampHeightMm = stampRatio === null ? stampWidthMm : stampWidthMm * stampRatio;

  // Centred on the page until it has been placed: a seal parked in a corner reads as
  // "already positioned" and gets delivered untouched.
  const position: StampPosition = value ?? {
    anchor: "top-left",
    offset_x_mm: Math.max(0, (surface.width_mm - stampWidthMm) / 2),
    offset_y_mm: Math.max(0, surface.height_mm - stampHeightMm - 20),
  };

  const clamp = useCallback(
    (x: number, y: number): StampPosition => ({
      anchor: "top-left",
      offset_x_mm: Number(Math.min(Math.max(x, 0), Math.max(surface.width_mm - stampWidthMm, 0)).toFixed(2)),
      offset_y_mm: Number(Math.min(Math.max(y, 0), Math.max(surface.height_mm - stampHeightMm, 0)).toFixed(2)),
    }),
    [surface.width_mm, surface.height_mm, stampWidthMm, stampHeightMm],
  );

  /** Client pixels → page millimetres, via the surface's rendered size. */
  const toMm = useCallback(
    (clientX: number, clientY: number) => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return null;

      return {
        x: ((clientX - rect.left) / rect.width) * surface.width_mm,
        y: ((clientY - rect.top) / rect.height) * surface.height_mm,
      };
    },
    [surface.width_mm, surface.height_mm],
  );

  function startDrag(event: React.PointerEvent<HTMLElement>) {
    if (disabled) return;
    const point = toMm(event.clientX, event.clientY);
    if (!point) return;

    grabRef.current = { x: point.x - position.offset_x_mm, y: point.y - position.offset_y_mm };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onDrag(event: React.PointerEvent<HTMLElement>) {
    if (!dragging || disabled) return;
    const point = toMm(event.clientX, event.clientY);
    if (!point) return;

    onChange(clamp(point.x - grabRef.current.x, point.y - grabRef.current.y));
  }

  function endDrag(event: React.PointerEvent<HTMLElement>) {
    if (!dragging) return;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  /**
   * Arrow keys move it too.
   *
   * Not only for keyboard users: a millimetre is smaller than a pixel at this zoom,
   * so tuning a seal to clear a signature line is genuinely easier by key than by
   * mouse. Shift jumps ten times as far.
   */
  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (disabled) return;
    const step = event.shiftKey ? NUDGE_COARSE_MM : NUDGE_MM;

    const delta = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    }[event.key];

    if (!delta) return;

    event.preventDefault();
    onChange(clamp(position.offset_x_mm + delta.x, position.offset_y_mm + delta.y));
  }

  // The seal's own aspect ratio decides how tall it is on the page, and it is only
  // known once the image has loaded — including from cache, which fires no event.
  useEffect(() => {
    const image = stampRef.current;
    if (image?.complete && image.naturalWidth > 0) {
      setStampRatio(image.naturalHeight / image.naturalWidth);
    }
  }, [stampSrc]);

  const percentX = (mm: number) => `${(mm / surface.width_mm) * 100}%`;
  const percentY = (mm: number) => `${(mm / surface.height_mm) * 100}%`;

  return (
    <div className="space-y-2">
      {/* Physical paper geometry — forced LTR so "left" is the sheet's left edge. */}
      <div
        ref={surfaceRef}
        dir="ltr"
        className="relative mx-auto w-full max-w-md overflow-hidden rounded-md border bg-white shadow-inner"
        style={{ aspectRatio: `${surface.width_mm} / ${surface.height_mm}` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- data: URI, one render */}
        <img
          src={surface.image}
          alt={`صفحة ${surface.page} من ${surface.pages}`}
          className="pointer-events-none absolute inset-0 size-full select-none object-contain"
          draggable={false}
        />

        <div
          role="application"
          aria-label="موضع الختم — اسحبه أو حرّكه بمفاتيح الأسهم"
          tabIndex={disabled ? -1 : 0}
          onPointerDown={startDrag}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
          className={[
            "absolute rounded-sm ring-2 ring-offset-1 transition-shadow",
            "focus-visible:outline-none focus-visible:ring-primary",
            disabled ? "cursor-not-allowed ring-transparent" : "cursor-grab ring-primary/60",
            dragging ? "cursor-grabbing shadow-lg ring-primary" : "",
          ].join(" ")}
          style={{
            left: percentX(position.offset_x_mm),
            top: percentY(position.offset_y_mm),
            width: percentX(stampWidthMm),
            // The pointer must not scroll the page out from under the drag on touch.
            touchAction: "none",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- streamed asset */}
          <img
            ref={stampRef}
            src={stampSrc}
            alt=""
            onLoad={(event) =>
              setStampRatio(event.currentTarget.naturalHeight / event.currentTarget.naturalWidth)
            }
            className="pointer-events-none block w-full select-none"
            draggable={false}
          />
        </div>
      </div>

      <p className="text-center text-[12px] text-muted-foreground" dir="rtl">
        صفحة {surface.page} من {surface.pages} · الختم على بُعد{" "}
        <span dir="ltr" className="font-mono">
          {position.offset_x_mm.toFixed(1)}
        </span>{" "}
        مم من اليسار و{" "}
        <span dir="ltr" className="font-mono">
          {position.offset_y_mm.toFixed(1)}
        </span>{" "}
        مم من الأعلى
      </p>
    </div>
  );
}
