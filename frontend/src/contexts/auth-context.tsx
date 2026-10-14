"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, clearTokens, hasTokens, saveTokens, type ApiUser, type Tokens } from "@/lib/api";

type AuthContextValue = {
  user: ApiUser | null;
  ready: boolean;
  updateUser: (user: ApiUser) => void;
  signIn: (email: string, password: string) => Promise<void>;
  register: (input: { name: string; email: string; password: string; phone?: string }) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [ready, setReady] = useState(false);

  const loadCurrentUser = useCallback(async () => {
    if (!hasTokens()) {
      setUser(null);
      setReady(true);
      return;
    }
    try {
      const result = await apiRequest<{ user: ApiUser }>("/api/users/me");
      setUser(result.user);
    } catch {
      clearTokens();
      setUser(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadCurrentUser);
  }, [loadCurrentUser]);

  useEffect(() => {
    const expireSession = () => setUser(null);
    window.addEventListener("career:auth-expired", expireSession);
    return () => window.removeEventListener("career:auth-expired", expireSession);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await apiRequest<{ user: ApiUser; tokens: Tokens }>(
      "/api/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) },
      { auth: false },
    );
    saveTokens(result.tokens);
    setUser(result.user);
    setReady(true);
  }, []);

  const register = useCallback(async (input: { name: string; email: string; password: string; phone?: string }) => {
    const result = await apiRequest<{ user: ApiUser; tokens: Tokens }>(
      "/api/auth/register",
      { method: "POST", body: JSON.stringify(input) },
      { auth: false },
    );
    saveTokens(result.tokens);
    setUser(result.user);
    setReady(true);
  }, []);

  const signOut = useCallback(async () => {
    const refreshToken = localStorage.getItem("career_refresh_token");
    try {
      if (refreshToken) {
        await apiRequest(
          "/api/auth/logout",
          { method: "POST", body: JSON.stringify({ refreshToken }) },
          { auth: false },
        );
      }
    } finally {
      clearTokens();
      setUser(null);
    }
  }, []);

  const value = useMemo(() => ({ user, ready, updateUser: setUser, signIn, register, signOut }), [user, ready, signIn, register, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}

export function ProtectedArea({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (ready && !user) router.replace("/login");
  }, [ready, user, router]);
  if (!ready || !user) return <div className="screen-loader" role="status">Checking your session…</div>;
  return children;
}

export function RedirectIfSignedIn({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (ready && user) router.replace("/dashboard");
  }, [ready, user, router]);
  if (!ready || user) return <div className="screen-loader" role="status">Loading your account…</div>;
  return children;
}
