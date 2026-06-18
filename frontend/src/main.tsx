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
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
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
