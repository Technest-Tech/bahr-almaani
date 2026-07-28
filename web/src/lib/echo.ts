import Echo from "laravel-echo";
import Pusher from "pusher-js";
import { getToken } from "./api";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
// /broadcasting/auth lives at the API origin root, not under /api/v1.
const AUTH_ENDPOINT = `${API_URL.replace(/\/api\/v1$/, "")}/broadcasting/auth`;

let instance: Echo<"reverb"> | null = null;

/**
 * Lazy singleton: created on first use after login (so the bearer token exists),
 * torn down via disconnectEcho() when the session ends.
 */
export function getEcho(): Echo<"reverb"> {
  if (!instance) {
    instance = new Echo({
      broadcaster: "reverb",
      Pusher,
      key: process.env.NEXT_PUBLIC_REVERB_KEY ?? "",
      wsHost: process.env.NEXT_PUBLIC_REVERB_HOST ?? "localhost",
      wsPort: Number(process.env.NEXT_PUBLIC_REVERB_PORT ?? 8080),
      wssPort: Number(process.env.NEXT_PUBLIC_REVERB_PORT ?? 8080),
      forceTLS: (process.env.NEXT_PUBLIC_REVERB_SCHEME ?? "http") === "https",
      enabledTransports: ["ws", "wss"],
      authEndpoint: AUTH_ENDPOINT,
      auth: {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
      },
    });
  }

  return instance;
}

export function disconnectEcho(): void {
  instance?.disconnect();
  instance = null;
}
