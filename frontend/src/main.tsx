import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "@/auth/session";
import { CelebrationProvider } from "@/components/Celebration";
import { initTheme } from "@/lib/theme";
import { App } from "@/App";
import "@/styles/index.css";

initTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    // staleTime 60s: navigating back to a page within a minute reuses cache instead
    // of refetching. Safe because every mutation explicitly invalidates what it
    // changes (and the hot actions update the cache optimistically). gcTime keeps
    // those cached pages warm for 10 min so revisits are instant.
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 60_000, gcTime: 600_000 },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <BrowserRouter>
          <CelebrationProvider>
            <App />
          </CelebrationProvider>
        </BrowserRouter>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
