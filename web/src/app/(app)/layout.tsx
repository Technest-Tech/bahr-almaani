"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { RealtimeProvider } from "@/components/realtime-provider";
import { useAuth } from "@/lib/auth";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-sidebar">
        <Loader2 className="size-8 animate-spin text-sidebar-primary" />
      </div>
    );
  }

  return (
    <RealtimeProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <TopBar />
          <main className="flex-1 px-5 py-6 lg:px-8">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </RealtimeProvider>
  );
}
