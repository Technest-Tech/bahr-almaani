"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LayoutDashboard, Menu, Moon, Sun, UserRound, X } from "lucide-react";
import { useTheme } from "next-themes";
import { BrandGlyph } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { useClientAuth } from "@/lib/client-auth";
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
  const { client, loading } = useClientAuth();
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
          <BrandGlyph size={36} />
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

          {/* This site is for clients, so its login is the client one. Staff reach
              the operations app via /login, linked from the client sign-in screen
              and discreetly in the footer — a PM typing their password into the
              client form is the confusion this ordering avoids. A signed-in client
              gets their area instead of a second invitation to sign in. */}
          {!loading &&
            (client ? (
              <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
                <Link href="/account">
                  <LayoutDashboard className="size-4" />
                  حسابي
                </Link>
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
                  <Link href="/account/login">تسجيل الدخول</Link>
                </Button>
                <Button variant="outline" size="sm" asChild className="hidden md:inline-flex">
                  <Link href="/account/register">
                    <UserRound className="size-4" />
                    حساب جديد
                  </Link>
                </Button>
              </>
            ))}

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
          {client ? (
            <Link
              href="/account"
              className="block rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:hidden"
            >
              حسابي
            </Link>
          ) : (
            <>
              <Link
                href="/account/login"
                className="block rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:hidden"
              >
                تسجيل الدخول
              </Link>
              <Link
                href="/account/register"
                className="block rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
              >
                حساب جديد
              </Link>
            </>
          )}
        </nav>
      )}
    </header>
  );
}
