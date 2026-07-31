"use client";

import { usePathname, useRouter } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { ChevronLeft, LogOut, Moon, Search, Settings, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { CommandPalette } from "@/components/layout/command-palette";
import { NotificationsBell } from "@/components/layout/notifications-bell";
import { BREADCRUMB_LABELS } from "@/components/layout/nav";
import { useAuth } from "@/lib/auth";
import { ROLE_LABELS, type Role } from "@/lib/types";

export function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { setTheme, resolvedTheme } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const segments = pathname.split("/").filter(Boolean);
  // "/" belongs to the public site now, so the trail is rooted at the dashboard —
  // and /dashboard itself must not appear twice.
  const crumbs = [
    { href: "/dashboard", label: BREADCRUMB_LABELS[""] },
    ...(segments[0] === "dashboard" ? [] : segments).map((segment, index) => ({
      href: "/" + segments.slice(0, index + 1).join("/"),
      label: BREADCRUMB_LABELS[segment] ?? "التفاصيل",
    })),
  ];

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 rounded-t-xl border-b bg-background/90 px-4 backdrop-blur-md lg:px-5">
      <SidebarTrigger className="-ms-1 text-muted-foreground" />
      <Separator orientation="vertical" className="me-2 h-4!" />

      {/* min-w-0 lets the trail shrink instead of shoving the actions off-screen;
          without it a flex child refuses to go below its content width. */}
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap">
          {crumbs.map((crumb, index) => {
            const isLast = index === crumbs.length - 1;
            return (
              <Fragment key={crumb.href}>
                {index > 0 && (
                  <BreadcrumbSeparator className="hidden sm:flex">
                    <ChevronLeft className="size-3.5" />
                  </BreadcrumbSeparator>
                )}
                {/* A phone leaves ~170px for the trail, so the ancestors are
                    dropped rather than wrapped onto a second line inside a
                    fixed h-14 header. The sidebar is the way back on mobile. */}
                <BreadcrumbItem className={isLast ? "min-w-0" : "hidden sm:inline-flex"}>
                  {isLast ? (
                    <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ms-auto flex shrink-0 items-center gap-1.5">
        <button
          onClick={() => setPaletteOpen(true)}
          className="flex h-8 items-center gap-2 rounded-lg border border-transparent bg-muted/70 px-3 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-muted sm:w-56"
        >
          <Search className="size-3.5" />
          <span className="hidden flex-1 text-start sm:block">بحث سريع…</span>
          <kbd className="pointer-events-none hidden select-none items-center rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] sm:flex">
            ⌘K
          </kbd>
        </button>

        <NotificationsBell />

        <Button
          variant="ghost"
          size="icon-sm"
          title="تبديل المظهر"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          <Sun className="size-4 dark:hidden" />
          <Moon className="hidden size-4 dark:block" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-full p-1 transition-colors hover:bg-accent">
              <Avatar className="size-7">
                <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                  {user?.name?.charAt(0)}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <p className="text-sm font-medium">{user?.name}</p>
              <p className="text-xs font-normal text-muted-foreground">
                {user?.roles.map((role) => ROLE_LABELS[role as Role] ?? role).join("، ")}
              </p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/settings")}>
              <Settings className="size-4" />
              الإعدادات
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => logout().then(() => router.replace("/login"))}
            >
              <LogOut className="size-4" />
              تسجيل الخروج
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </header>
  );
}
