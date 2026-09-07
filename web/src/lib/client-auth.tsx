"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, getToken, setToken, type ApiOptions } from "./api";
import type { ClientAccount } from "./types";

/** Every client-area call, with the client realm's token attached. */
export function clientApi<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  return api<T>(path, { ...options, realm: "client" });
}

export interface ClientRegistration {
  name: string;
  type: "individual" | "company";
  phone?: string;
  email: string;
  password: string;
  password_confirmation: string;
}

interface ClientAuthState {
  client: ClientAccount | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: ClientRegistration) => Promise<void>;
  logout: () => Promise<void>;
  refresh: (client: ClientAccount) => void;
}

const ClientAuthContext = createContext<ClientAuthState | null>(null);

/**
 * The website's client session (M15) — deliberately separate from `useAuth`,
 * which is the staff session for the operations app. They use different tokens
 * against different tables, and a visitor can hold both at once on a shared
 * office machine without either one disturbing the other.
 */
export function ClientAuthProvider({ children }: { children: React.ReactNode }) {
  const [client, setClient] = useState<ClientAccount | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (getToken("client")) {
          // Handled below by dropping the token — see the note in lib/auth.tsx.
          const data = await clientApi<{ client: ClientAccount }>("/client/auth/me", {
            redirectOn401: false,
          });
          if (!cancelled) setClient(data.client);
        }
      } catch {
        setToken(null, "client");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await clientApi<{ token: string; client: ClientAccount }>(
      "/client/auth/login",
      { method: "POST", json: { email, password } },
    );
    setToken(data.token, "client");
    setClient(data.client);
  }, []);

  const register = useCallback(async (payload: ClientRegistration) => {
    const data = await clientApi<{ token: string; client: ClientAccount }>(
      "/client/auth/register",
      { method: "POST", json: payload },
    );
    setToken(data.token, "client");
    setClient(data.client);
  }, []);

  const logout = useCallback(async () => {
    try {
      await clientApi("/client/auth/logout", { method: "POST" });
    } finally {
      setToken(null, "client");
      setClient(null);
    }
  }, []);

  return (
    <ClientAuthContext.Provider
      value={{ client, loading, login, register, logout, refresh: setClient }}
    >
      {children}
    </ClientAuthContext.Provider>
  );
}

export function useClientAuth(): ClientAuthState {
  const context = useContext(ClientAuthContext);
  if (!context) throw new Error("useClientAuth must be used within ClientAuthProvider");
  return context;
}
