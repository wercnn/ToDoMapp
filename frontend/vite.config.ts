import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // App code.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // The shared HTTP contract — the backend's PURE api-types barrel (type-only,
      // zero runtime, so it never pulls a server dependency into the browser bundle).
      // Single source of truth: `../src/api-types.ts`.
      "@api-types": fileURLToPath(new URL("../src/api-types.ts", import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
});
