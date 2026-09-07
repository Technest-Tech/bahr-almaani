"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2, LogOut } from "lucide-react";
import { useClientAuth } from "@/lib/client-auth";
import { AccountNav } from "@/components/account/account-nav";
import { Button } from "@/components/ui/button";

/**
 * The signed-in half of the client area. /account/login and /account/register sit
 * outside this route group precisely so they escape the guard below.
 */
export default function AccountPortalLayout({ children }: { children: React.ReactNode }) {
  const { client, loading, logout } = useClientAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !client) router.replace("/account/login");
  }, [loading, client, router]);

  if (loading || !client) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13px] text-muted-foreground">
            {client.type === "company" ? "حساب شركة" : "حساب فرد"}
          </p>
          <h1 className="mt-0.5 truncate text-2xl font-bold tracking-tight">{client.name}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground" dir="ltr">
            {client.email}
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await logout();
            router.replace("/");
          }}
        >
          <LogOut className="size-4" />
          خروج
        </Button>
      </div>

      <div className="mt-6">
        <AccountNav />
      </div>

      <div className="pt-6">{children}</div>
    </div>
  );
}
