/**
 * Session context — the single source of auth truth for the UI. Subscribes to
 * Supabase auth changes, exposes the current user + sign-in/out, and wires the
 * API client's 401 handler so an expired token bounces the app to login.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { setUnauthorizedHandler } from "@/api/client";

interface SessionContextValue {
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // A 401 from the API means the token is no longer valid — drop the session so
  // route guards send the user to /login.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void supabase.auth.signOut();
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      loading,
      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [session, loading],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within <SessionProvider>");
  return ctx;
}
