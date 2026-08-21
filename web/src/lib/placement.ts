import type { CSSProperties } from "react";
import type { Placement } from "@/lib/types";

/** A4 portrait — the sheet the placement preview draws. */
export const A4_MM = { width: 210, height: 297 };

const percentX = (mm: number) => `${(mm / A4_MM.width) * 100}%`;
const percentY = (mm: number) => `${(mm / A4_MM.height) * 100}%`;

/**
 * CSS placement of the asset on a page-shaped preview box (must be `dir="ltr"`:
 * this is physical paper geometry). Same semantics as
 * `App\Support\PlacementConfig::resolveRect()` — offsets grow from the anchored
 * edge, and shift right/down on a centre anchor. Height stays automatic so the
 * asset keeps its aspect ratio, exactly as `width_mm` implies in the merge.
 */
export function placementStyle(placement: Placement): CSSProperties {
  const [vertical, horizontal] = placement.anchor.split("-");
  const offsetX = percentX(placement.offset_x_mm);
  const offsetY = percentY(placement.offset_y_mm);
  const transforms: string[] = [];

  const style: CSSProperties = {
    position: "absolute",
    width: percentX(placement.width_mm ?? A4_MM.width),
    height: "auto",
    opacity: placement.opacity,
  };

  // A null width_mm is "full bleed", and the merge resolves it by fitting the artwork
  // inside the page, not to its width (PlacementConfig::containedWidth). max-height
  // reproduces that here: the browser re-derives the used width from the constrained
  // height, so a taller-than-A4 asset letterboxes in the preview exactly as it does
  // in the export instead of running off the bottom of the sheet.
  if (placement.width_mm === null) style.maxHeight = "100%";

  if (horizontal === "left") style.left = offsetX;
  else if (horizontal === "right") style.right = offsetX;
  else {
    style.left = `calc(50% + ${offsetX})`;
    transforms.push("translateX(-50%)");
  }

  if (vertical === "top") style.top = offsetY;
  else if (vertical === "bottom") style.bottom = offsetY;
  else {
    style.top = `calc(50% + ${offsetY})`;
    transforms.push("translateY(-50%)");
  }

  if (transforms.length) style.transform = transforms.join(" ");

  return style;
}

/**
 * The band the translated text is laid out in, as CSS on the same preview box.
 *
 * This is what a Word deliverable gets: its page margins are widened before
 * conversion (App\Support\DocxPageMargins), so the text reflows into the band at
 * full size and full width. Returns null when the letterhead reserves no band, i.e.
 * the merge is a plain overlay.
 */
export function contentBandStyle(placement: Placement): CSSProperties | null {
  const band = bandMm(placement);

  if (!band) return null;

  return {
    position: "absolute",
    left: 0,
    right: 0,
    top: percentY(band.top),
    height: percentY(band.available),
  };
}

/**
 * The smaller rectangle a deliverable that CANNOT be reflowed is shrunk into — a PDF
 * the translator hands over ready-made, or a scan.
 *
 * Mirrors `PlacementConfig::resolveContentRect()` — change both together. Drawn
 * alongside `contentBandStyle` so the admin can see what the two paths cost before
 * committing a band: the scale is uniform, so the page loses width as well as
 * height, and a 33/27mm band on A4 leaves a 21mm blank gutter down each side.
 */
export function contentShrinkStyle(placement: Placement): CSSProperties | null {
  const band = bandMm(placement);

  if (!band) return null;

  const width = A4_MM.width * (band.available / A4_MM.height);

  return {
    position: "absolute",
    left: percentX((A4_MM.width - width) / 2),
    width: percentX(width),
    top: percentY(band.top),
    height: percentY(band.available),
  };
}

/** Shared band arithmetic; null when nothing is reserved or the band leaves no room. */
function bandMm(placement: Placement): { top: number; available: number } | null {
  const top = placement.content_top_mm ?? 0;
  const bottom = placement.content_bottom_mm ?? 0;

  if (top <= 0 && bottom <= 0) return null;

  const available = A4_MM.height - top - bottom;

  return available > 0 ? { top, available } : null;
}
