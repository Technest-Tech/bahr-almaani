"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandGlyph } from "@/components/brand-logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { NAV_ITEMS } from "@/components/layout/nav";
import { useAuth } from "@/lib/auth";

export function AppSidebar() {
  const pathname = usePathname();
  const { can } = useAuth();

  return (
    <Sidebar side="right" variant="inset" collapsible="icon">
      <SidebarHeader className="pb-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild className="hover:bg-sidebar-accent/50">
              <Link href="/dashboard">
                <BrandGlyph size={36} onDark />
                <div className="grid flex-1 text-start leading-tight">
                  <span className="truncate text-[15px] font-bold text-white">بحر المعاني</span>
                  <span className="truncate text-[11px] text-sidebar-foreground/60">
                    إدارة خدمات الترجمة
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/40">
            القائمة الرئيسية
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {NAV_ITEMS.filter((item) => !item.permission || can(item.permission)).map(
                (item) => {
                  const active = pathname.startsWith(item.href);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.label}
                        className="h-10 gap-3 px-3 text-[13.5px] font-medium text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-white data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold data-[active=true]:text-sidebar-accent-foreground"
                      >
                        <Link href={item.href}>
                          <item.icon className="size-[18px]!" />
                          <span>{item.label}</span>
                          {active && (
                            <span className="absolute inset-y-2 -end-2 w-1 rounded-full bg-gold-500" />
                          )}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                },
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border pt-3">
        <p className="px-2 text-[10px] text-sidebar-foreground/40 group-data-[collapsible=icon]:hidden">
          الإصدار التجريبي — Sprint 2
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
