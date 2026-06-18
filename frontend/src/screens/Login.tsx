/**
 * Login — Supabase email/password. On success we call /auth/bootstrap (idempotent
 * first-login provisioning; safe to run every login) before entering the app, then
 * route guards take over.
 */
import { useState, type FormEvent } from "react";
import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { useSession } from "@/auth/session";
import { authApi } from "@/api";
import { Button } from "@/components/ui/button";

export function Login() {
  const { session, loading, signIn } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Default to "/" so the entry gate routes to onboarding vs the shell.
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  if (!loading && session) return <Navigate to={from} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
      // Provision user + personal workspace if first login (idempotent).
      await authApi.bootstrap({ email });
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex min-h-full items-center justify-center px-6 py-12"
      style={{ background: "radial-gradient(1200px 600px at 50% -10%, var(--backdrop-glow), var(--bg))" }}
    >
      <div className="w-full max-w-[400px] rounded-[18px] border border-border bg-surface-1 p-8">
        <div className="mb-7 flex items-center gap-2.5">
          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-progress text-[16px] font-black text-on-accent">
            ▲
          </span>
          <span className="text-[15px] font-black">TodoMapp</span>
        </div>

        <h1 className="mb-1 text-2xl font-black tracking-tight">Welcome back</h1>
        <p className="mb-6 text-sm font-semibold text-text-secondary">
          Sign in to pick up your roadmap.
        </p>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-text-tertiary">
              Email
            </span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-[11px] border border-border bg-bg px-4 py-3 text-[15px] font-bold text-text-primary outline-none focus:border-progress"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-text-tertiary">
              Password
            </span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-[11px] border border-border bg-bg px-4 py-3 text-[15px] font-bold text-text-primary outline-none focus:border-progress"
            />
          </label>

          {error && (
            <p className="rounded-[10px] bg-warning-soft px-3 py-2 text-xs font-bold text-warning">
              {error}
            </p>
          )}

          <Button type="submit" disabled={busy} className="mt-2 w-full">
            {busy ? "Signing in…" : "Sign in →"}
          </Button>
        </form>
      </div>
    </div>
  );
}
