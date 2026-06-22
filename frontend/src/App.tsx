/**
 * Routes. Public /login; everything else is behind the auth guard.
 *
 * Entry gate: "/" runs the onboarding resume check and sends the user to
 * /onboarding (no confirmed day yet — fresh OR a partial WBS to resume) or into
 * the shell at /home. Onboarding lives OUTSIDE the shell (focused step-states,
 * web-screens §A). Roadmap/Project Detail stay placeholders until F3/F4.
 */
import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Shell } from "@/screens/shell/Shell";
import { Login } from "@/screens/Login";
import { Home } from "@/screens/Home";
import { Roadmap } from "@/screens/roadmap/Roadmap";
import { ProjectDetail } from "@/screens/project/ProjectDetail";
import { Onboarding } from "@/screens/onboarding/Onboarding";
import { useOnboardingResume } from "@/screens/onboarding/useOnboardingResume";

/** Decide first destination: onboarding (incl. resume) vs the live shell. */
function EntryGate() {
  const resume = useOnboardingResume();
  if (resume.isLoading) {
    return (
      <div className="flex min-h-full items-center justify-center text-sm font-bold text-text-tertiary">
        Loading your workspace…
      </div>
    );
  }
  // Fail open to Home — it already handles the empty/partial new-user state.
  if (resume.isError || !resume.data) return <Navigate to="/home" replace />;
  return <Navigate to={resume.data.complete ? "/home" : "/onboarding"} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/onboarding"
        element={
          <ProtectedRoute>
            <Onboarding />
          </ProtectedRoute>
        }
      />
      <Route
        element={
          <ProtectedRoute>
            <Shell />
          </ProtectedRoute>
        }
      >
        <Route path="/home" element={<Home />} />
        <Route path="/morning-brief" element={<Home />} />
        <Route path="/roadmap" element={<Roadmap />} />
        <Route path="/projects/:projectId" element={<ProjectDetail />} />
      </Route>
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <EntryGate />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
