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
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id;
  // Stable dependency: pair list only changes via admin edits + relogin.
  const pairsKey = (user?.language_pairs ?? [])
    .map((pair) => `${pair.source_language_id}.${pair.target_language_id}`)
    .join(",");

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
      })
      .listen(".project.delivered", () => {
        queryClient.invalidateQueries({ queryKey: ["projects"] });
        queryClient.invalidateQueries({ queryKey: ["project"] });
        queryClient.invalidateQueries({ queryKey: ["project-timeline"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      });

    // ── One portal channel per language pair (translators only) ───────
    const pairs = pairsKey ? pairsKey.split(",") : [];
    pairs.forEach((pair) => {
      const channel = echo.private(`portal.${pair}`);

          channel.listen(".project.claimed", (event: PortalQueuePayload) => {
            // The wow moment: drop the card from the cache the instant a
            // colleague claims it, then reconcile with the server.
            queryClient.setQueryData<Paginated<Project>>(["portal-queue"], (old) =>
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
        channel.listen(name, invalidatePortal);
      }
    });

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
      pairs.forEach((pair) => echo.leave(`portal.${pair}`));
      disconnectEcho();
    };
  }, [userId, pairsKey, queryClient]);

  return children;
}
