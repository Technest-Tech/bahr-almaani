import type { Metadata } from "next";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { COMPANY } from "@/lib/company";

export const metadata: Metadata = {
  title: `${COMPANY.name} — ${COMPANY.tagline}`,
  description: COMPANY.pitch,
};

/**
 * The public website (M13). Unlike the operations app this layout is
 * unauthenticated and deliberately centred: marketing pages read badly at
 * 2000px, so the internal "always full width" rule stops at the login wall.
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
