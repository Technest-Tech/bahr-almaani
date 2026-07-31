"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, Moon, Sun, Waves, X } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/#services", label: "خدماتنا" },
  { href: "/#process", label: "كيف نعمل" },
  { href: "/#why", label: "لماذا نحن" },
  { href: "/#faq", label: "أسئلة شائعة" },
  { href: "/track", label: "تتبع طلبك" },
];

export function SiteHeader() {
  const { setTheme, resolvedTheme } = useTheme();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // The header starts transparent over the hero and gains its surface on scroll.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-all",
        scrolled ? "border-b bg-background/80 backdrop-blur-lg" : "border-b border-transparent",
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-teal-400 to-teal-700 text-white shadow-lg shadow-teal-900/25">
            <Waves className="size-5" />
          </span>
          <span className="grid leading-tight">
            <span className="text-[15px] font-bold">بحر المعاني</span>
            <span className="text-[11px] text-muted-foreground">للترجمة المعتمدة</span>
          </span>
        </Link>

        <nav className="ms-6 hidden items-center gap-1 lg:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-2 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ms-auto flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon-sm"
            title="تبديل المظهر"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          >
            <Sun className="size-4 dark:hidden" />
            <Moon className="hidden size-4 dark:block" />
          </Button>

          {/* No panel link here — this site is for clients. Staff reach the app via
              /login (also linked discreetly in the footer), which forwards an already
              signed-in user straight to the dashboard. */}
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
            <Link href="/login">تسجيل الدخول</Link>
          </Button>

          <Button size="sm" asChild>
            <Link href="/request">اطلب عرض سعر</Link>
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            aria-label="القائمة"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </Button>
        </div>
      </div>

      {menuOpen && (
        // Closed on tap rather than on a pathname effect — most of these are hash
        // links, which never change the pathname and would leave the menu open.
        <nav className="border-t bg-background px-4 py-2 lg:hidden" onClick={() => setMenuOpen(false)}>
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="block rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/login"
            className="block rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:hidden"
          >
            تسجيل الدخول
          </Link>
        </nav>
      )}
    </header>
  );
}
