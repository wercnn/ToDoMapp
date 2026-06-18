/**
 * Route guard — gates the authenticated shell. No session → bounce to /login,
 * remembering where we were headed so login can return there.
 */
import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useSession } from "@/auth/session";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center text-sm font-bold text-text-tertiary">
        Loading…
      </div>
    );
  }
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
