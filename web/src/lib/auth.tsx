"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, setToken, getToken } from "./api";
import type { User } from "./types";

interface AuthState {
  user: User | null;
  permissions: string[];
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (getToken()) {
          const data = await api<{ user: User; permissions: string[] }>("/auth/me");
          if (!cancelled) {
            setUser(data.user);
            setPermissions(data.permissions);
          }
        }
      } catch {
        setToken(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      json: { email, password },
    });
    setToken(data.token);
    const me = await api<{ user: User; permissions: string[] }>("/auth/me");
    setUser(me.user);
    setPermissions(me.permissions);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      setToken(null);
      setUser(null);
      setPermissions([]);
    }
  }, []);

  const can = useCallback(
    (permission: string) => permissions.includes(permission),
    [permissions],
  );

  return (
    <AuthContext.Provider value={{ user, permissions, loading, login, logout, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
