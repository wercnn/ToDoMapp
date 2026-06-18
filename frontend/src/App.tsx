/**
 * Routes. Public /login; everything else is behind the auth guard + app shell.
 * Roadmap and Project Detail are placeholders until F3/F4.
 */
import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Shell } from "@/screens/shell/Shell";
import { Login } from "@/screens/Login";
import { Home } from "@/screens/Home";

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="p-6">
      <h2 className="text-xl font-black">{title}</h2>
      <p className="mt-2 text-sm font-semibold text-text-tertiary">Arrives in a later phase.</p>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <Shell />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<Home />} />
        <Route path="/roadmap" element={<ComingSoon title="Roadmap" />} />
      </Route>
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
}
