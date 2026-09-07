"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, LayoutDashboard, Receipt, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/account", label: "نظرة عامة", icon: LayoutDashboard },
  { href: "/account/projects", label: "مشاريعي", icon: FileText },
  { href: "/account/invoices", label: "فواتيري", icon: Receipt },
  { href: "/account/profile", label: "بياناتي", icon: UserRound },
];

export function AccountNav() {
  const pathname = usePathname();

  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto border-b">
      {TABS.map((tab) => {
        // /account matches exactly; the rest also own their sub-pages.
        const active =
          tab.href === "/account" ? pathname === tab.href : pathname.startsWith(tab.href);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-[13.5px] font-medium transition-colors",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <tab.icon className="size-4" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
