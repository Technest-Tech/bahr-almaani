"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { disconnectEcho, getEcho } from "@/lib/echo";
import { useAuth } from "@/lib/auth";
import type { Paginated, Project } from "@/lib/types";

/** Payload of Echo's `.notification()` — our broadcastType() slug + toArray() data. */
interface BroadcastNotification {
  id: string;
  type: string;
  project_id?: number;
  code?: string;
  message: string;
}

interface PortalQueuePayload {
  project: Pick<Project, "id" | "code" | "title" | "priority" | "status"> & {
    deadline_at: string;
  };
}

const PORTAL_NOTIFICATION_TYPES = new Set([
  "project_available",
  "revision_requested",
  "project_withdrawn",
]);

/**
 * Replaces the old 15s/30s polling: keeps the bell, the portal queue and the
 * PM's project views in sync over Reverb websockets. Mounted once inside the
 * authenticated app shell.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { user, can } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id;
  // One shared portal feed, joined by anyone who can open the portal — the queue
  // is no longer scoped to a translator's language pairs, so neither is the feed.
  const canPortal = can("portal.access");

  useEffect(() => {
    if (!userId) return;

    const echo = getEcho();

    const invalidatePortal = () => {
      queryClient.invalidateQueries({ queryKey: ["portal-queue"] });
      queryClient.invalidateQueries({ queryKey: ["portal-current"] });
      queryClient.invalidateQueries({ queryKey: ["portal-history"] });
    };

    // ── Personal channel: bell + PM review views ──────────────────────
    const personal = echo
      .private(`App.Models.User.${userId}`)
      .notification((notification: BroadcastNotification) => {
        queryClient.invalidateQueries({ queryKey: ["notifications"] });
        toast.info(notification.message);
        if (PORTAL_NOTIFICATION_TYPES.has(notification.type)) invalidatePortal();
        if (notification.type === "report_ready") {
          queryClient.invalidateQueries({ queryKey: ["report-exports"] });
        }
      })
      .listen(".project.delivered", () => {
        queryClient.invalidateQueries({ queryKey: ["projects"] });
        queryClient.invalidateQueries({ queryKey: ["project"] });
        queryClient.invalidateQueries({ queryKey: ["project-timeline"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      });

    // ── The shared portal queue feed (anyone with portal access) ──────
    const portal = canPortal ? echo.private("portal") : null;

    if (portal) {
      portal.listen(".project.claimed", (event: PortalQueuePayload) => {
        // The wow moment: drop the card from the cache the instant a
        // colleague claims it, then reconcile with the server.
        //
        // setQueriesData, not setQueryData: the queue is cached per filter
        // combination (["portal-queue", "?priority=urgent"] and friends), so
        // targeting the bare key would quietly miss every filtered view.
        queryClient.setQueriesData<Paginated<Project>>({ queryKey: ["portal-queue"] }, (old) =>
          old
            ? {
                ...old,
                data: old.data.filter((p) => p.id !== event.project.id),
                meta: { ...old.meta, total: Math.max(0, old.meta.total - 1) },
              }
            : old,
        );
        queryClient.invalidateQueries({ queryKey: ["portal-queue"] });
      });

      for (const name of [".project.published", ".project.withdrawn", ".project.cancelled"]) {
        portal.listen(name, invalidatePortal);
      }
    }

    // After a reconnect (laptop slept, Reverb restarted) events were missed —
    // refetch everything realtime normally keeps fresh.
    const connection = echo.connector.pusher.connection;
    let wasDisconnected = false;
    const onStateChange = (states: { previous: string; current: string }) => {
      if (states.current === "connected" && wasDisconnected) {
        invalidatePortal();
        queryClient.invalidateQueries({ queryKey: ["notifications"] });
        queryClient.invalidateQueries({ queryKey: ["projects"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      }
      if (states.current === "unavailable" || states.current === "disconnected") {
        wasDisconnected = true;
      }
    };
    connection.bind("state_change", onStateChange);

    return () => {
      connection.unbind("state_change", onStateChange);
      personal.stopListening(".project.delivered");
      echo.leave(`App.Models.User.${userId}`);
      if (portal) echo.leave("portal");
      disconnectEcho();
    };
  }, [userId, canPortal, queryClient]);

  return children;
}
