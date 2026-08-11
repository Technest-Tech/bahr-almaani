"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

/**
 * The live register of file transfers, rendered by <TransferPanel>.
 *
 * Why this exists: uploads and downloads here are 5–20 MB over links that measure
 * ~5 Mbit/s, so a transfer routinely runs 30 seconds. Before this the UI showed
 * nothing at all for that whole time and the system read as hung — which is the
 * complaint that produced this module. The bytes cannot arrive faster; what was
 * missing was any evidence that they were arriving.
 *
 * Transfers are tracked globally rather than per-component so a download survives
 * navigating away from the page that started it.
 */

export type TransferKind = "upload" | "download";

export type TransferStatus = "active" | "done" | "error" | "cancelled";

export interface Transfer {
  id: string;
  kind: TransferKind;
  name: string;
  /** Bytes moved so far. */
  loaded: number;
  /** Total bytes, or null when the server sent no Content-Length. */
  total: number | null;
  status: TransferStatus;
  /** Bytes per second, smoothed. Null until there is enough signal to be honest. */
  speed: number | null;
  /** Seconds remaining, or null when unknowable (no total, or no speed yet). */
  eta: number | null;
  error?: string;
  cancel?: () => void;
}

interface TransferContextValue {
  transfers: Transfer[];
  /** Registers a transfer and returns handles to drive it. */
  start: (input: { kind: TransferKind; name: string; cancel?: () => void }) => TransferHandle;
  dismiss: (id: string) => void;
  clearFinished: () => void;
}

export interface TransferHandle {
  id: string;
  progress: (loaded: number, total: number | null) => void;
  succeed: () => void;
  fail: (message: string) => void;
  cancel: () => void;
}

const TransferContext = createContext<TransferContextValue | null>(null);

/** Exponential smoothing — raw deltas jump around far too much to display. */
const SPEED_SMOOTHING = 0.3;

/** A finished row lingers this long so the user sees it land, then clears itself. */
const AUTO_DISMISS_MS = 4000;

export function TransferProvider({ children }: { children: React.ReactNode }) {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const counter = useRef(0);
  // Sampling state per transfer, kept out of React state — it changes on every
  // chunk and none of it is rendered directly.
  const samples = useRef(new Map<string, { at: number; loaded: number; speed: number }>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const patch = useCallback((id: string, next: Partial<Transfer>) => {
    setTransfers((current) =>
      current.map((transfer) => (transfer.id === id ? { ...transfer, ...next } : transfer)),
    );
  }, []);

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    samples.current.delete(id);
    setTransfers((current) => current.filter((transfer) => transfer.id !== id));
  }, []);

  const scheduleDismiss = useCallback(
    (id: string) => {
      const timer = setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  const start = useCallback<TransferContextValue["start"]>(
    ({ kind, name, cancel }) => {
      counter.current += 1;
      const id = `t${counter.current}`;

      setTransfers((current) => [
        ...current,
        { id, kind, name, loaded: 0, total: null, status: "active", speed: null, eta: null, cancel },
      ]);
      samples.current.set(id, { at: Date.now(), loaded: 0, speed: 0 });

      return {
        id,
        progress(loaded, total) {
          const now = Date.now();
          const previous = samples.current.get(id);
          let speed: number | null = null;

          // Sample at most ~5×/s: below that the elapsed window is too short to
          // divide by without the figure swinging wildly.
          if (previous && now - previous.at >= 200) {
            const instant = ((loaded - previous.loaded) * 1000) / (now - previous.at);
            speed = previous.speed
              ? previous.speed * (1 - SPEED_SMOOTHING) + instant * SPEED_SMOOTHING
              : instant;
            samples.current.set(id, { at: now, loaded, speed });
          } else if (previous) {
            speed = previous.speed || null;
          }

          const remaining = total !== null && speed && speed > 0 ? (total - loaded) / speed : null;
          patch(id, { loaded, total, speed: speed && speed > 0 ? speed : null, eta: remaining });
        },
        succeed() {
          patch(id, { status: "done", eta: null, speed: null });
          scheduleDismiss(id);
        },
        fail(message) {
          patch(id, { status: "error", error: message, eta: null, speed: null });
        },
        cancel() {
          patch(id, { status: "cancelled", eta: null, speed: null });
          scheduleDismiss(id);
        },
      };
    },
    [patch, scheduleDismiss],
  );

  const clearFinished = useCallback(() => {
    setTransfers((current) => current.filter((transfer) => transfer.status === "active"));
  }, []);

  const value = useMemo(
    () => ({ transfers, start, dismiss, clearFinished }),
    [transfers, start, dismiss, clearFinished],
  );

  return <TransferContext.Provider value={value}>{children}</TransferContext.Provider>;
}

export function useTransfers(): TransferContextValue {
  const context = useContext(TransferContext);
  if (!context) throw new Error("useTransfers must be used inside <TransferProvider>");
  return context;
}
