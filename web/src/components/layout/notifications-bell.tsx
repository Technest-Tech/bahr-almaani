"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { api } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import type { AppNotification } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface NotificationsResponse {
  data: AppNotification[];
  unread_count: number;
}

const PORTAL_TYPES = new Set(["project_available", "revision_requested", "project_withdrawn"]);

export function NotificationsBell() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<NotificationsResponse>("/notifications"),
    refetchInterval: 30_000,
  });

  const unread = data?.unread_count ?? 0;

  const markAllMutation = useMutation({
    mutationFn: () => api("/notifications/read-all", { method: "PUT" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markOne = useMutation({
    mutationFn: (id: string) => api("/notifications/read", { method: "PUT", json: { ids: [id] } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  function open(notification: AppNotification) {
    if (!notification.read_at) markOne.mutate(notification.id);
    if (PORTAL_TYPES.has(notification.data.type)) router.push("/portal");
    else if (notification.data.project_id) router.push(`/projects/${notification.data.project_id}`);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="الإشعارات"
        >
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute -end-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-white">
              {unread > 9 ? "٩+" : unread.toLocaleString("ar-EG")}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">الإشعارات</p>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              onClick={() => markAllMutation.mutate()}
            >
              <CheckCheck className="size-3" />
              تحديد الكل كمقروء
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-96">
          {!data?.data.length && (
            <p className="py-10 text-center text-xs text-muted-foreground">لا توجد إشعارات</p>
          )}
          <ul className="divide-y">
            {data?.data.map((notification) => (
              <li key={notification.id}>
                <button
                  onClick={() => open(notification)}
                  className={cn(
                    "flex w-full items-start gap-2.5 px-3 py-2.5 text-start transition-colors hover:bg-accent",
                    !notification.read_at && "bg-primary/5",
                  )}
                >
                  <span
                    className={cn(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      notification.read_at ? "bg-transparent" : "bg-primary",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] leading-snug">
                      {notification.data.message}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {formatRelative(notification.created_at)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
