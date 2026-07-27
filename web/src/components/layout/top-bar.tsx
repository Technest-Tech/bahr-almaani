"use client";

import { usePathname, useRouter } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { ChevronLeft, LogOut, Moon, Search, Sun } from "lucide-react";
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
  const crumbs = [
    { href: "/", label: BREADCRUMB_LABELS[""] },
    ...segments.map((segment, index) => ({
      href: "/" + segments.slice(0, index + 1).join("/"),
      label: BREADCRUMB_LABELS[segment] ?? "التفاصيل",
    })),
  ];

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur-md">
      <SidebarTrigger className="-ms-1" />
      <Separator orientation="vertical" className="me-2 h-4!" />

      <Breadcrumb>
        <BreadcrumbList>
          {crumbs.map((crumb, index) => (
            <Fragment key={crumb.href}>
              {index > 0 && (
                <BreadcrumbSeparator>
                  <ChevronLeft className="size-3.5" />
                </BreadcrumbSeparator>
              )}
              <BreadcrumbItem>
                {index === crumbs.length - 1 ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ms-auto flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-muted-foreground"
          onClick={() => setPaletteOpen(true)}
        >
          <Search className="size-3.5" />
          <span className="hidden sm:inline">بحث سريع…</span>
          <kbd className="pointer-events-none hidden select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] sm:flex">
            ⌘K
          </kbd>
        </Button>

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
