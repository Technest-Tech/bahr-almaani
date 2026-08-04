import Image from "next/image";
import { cn } from "@/lib/utils";

/*
 * The logo comes in two cuts, both derived from the master mark:
 *   glyph — the globe and arrows alone, the only cut legible below ~64px
 *   lockup — globe, ring text and wordmark, for the one place with room for it
 *
 * Each has an on-dark variant whose navy ink is white: the arrows overhang the
 * gold sphere, so on a navy surface the original loses its tips. Surfaces that
 * are dark in both themes (the sidebar) pass `onDark`; theme-dependent surfaces
 * ship both and let the dark variant swap in.
 */

const GLYPH = "/brand/logo-glyph.png";
const GLYPH_DARK = "/brand/logo-glyph-on-dark.png";
const LOCKUP = "/brand/logo-full.png";
const LOCKUP_DARK = "/brand/logo-full-on-dark.png";

export function BrandGlyph({
  size = 36,
  onDark = false,
  className,
}: {
  size?: number;
  /** Surface is dark in both themes — skip the swap and always use white ink. */
  onDark?: boolean;
  className?: string;
}) {
  // Decorative everywhere it is used: the name sits beside it as real text.
  const shared = {
    width: size,
    height: size,
    priority: true,
    className: cn("shrink-0 object-contain", className),
    style: { width: size, height: size },
  } as const;

  if (onDark) return <Image src={GLYPH_DARK} alt="" {...shared} />;

  return (
    <>
      <Image src={GLYPH} alt="" {...shared} className={cn(shared.className, "dark:hidden")} />
      <Image
        src={GLYPH_DARK}
        alt=""
        {...shared}
        className={cn(shared.className, "hidden dark:block")}
      />
    </>
  );
}

/** Full lockup — globe, ring text and English wordmark. Needs ~120px of height. */
export function BrandLockup({
  height = 96,
  className,
}: {
  height?: number;
  className?: string;
}) {
  // Master aspect ratio, 956 × 815.
  const width = Math.round((height * 956) / 815);
  const alt = "بحر المعاني للترجمة القانونية";
  const shared = {
    width,
    height,
    priority: true,
    className: cn("object-contain", className),
    style: { height, width },
  } as const;

  return (
    <>
      <Image src={LOCKUP} alt={alt} {...shared} className={cn(shared.className, "dark:hidden")} />
      <Image
        src={LOCKUP_DARK}
        alt={alt}
        {...shared}
        className={cn(shared.className, "hidden dark:block")}
      />
    </>
  );
}
