import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // The completion-cascade test is an integration test: it exercises the real
    // partial unique indexes that guard against double-awarding points, so it
    // must run against a real Postgres (the configured Supabase database).
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // DB-backed tests share a workspace lifecycle; keep them serial and give the
    // network round-trips to Supabase room to breathe.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
