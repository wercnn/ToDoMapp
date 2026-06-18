/**
 * ErrorBoundary — a minimal class boundary. Suspense surfaces *loading*, but not a
 * chunk that fails to load (e.g. the lazy Flow canvas on a flaky network). This
 * catches that render error and shows a calm, token-driven fallback instead of a
 * blank screen. Render-time only (React error boundaries don't catch async handlers;
 * those go through calmMessage at the call site).
 */
import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
