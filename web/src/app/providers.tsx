"use client";

import { DirectionProvider } from "@radix-ui/react-direction";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { ConfirmProvider } from "@/components/confirm";
import { TransferPanel } from "@/components/transfer-panel";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/auth";
import { TransferProvider } from "@/lib/transfers";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false },
        },
      }),
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <DirectionProvider dir="rtl">
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ConfirmProvider>
              <TransferProvider>
                {children}
                <TransferPanel />
                <Toaster position="bottom-left" dir="rtl" richColors closeButton />
              </TransferProvider>
            </ConfirmProvider>
          </AuthProvider>
        </QueryClientProvider>
      </DirectionProvider>
    </ThemeProvider>
  );
}
