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
