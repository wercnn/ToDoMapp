/**
 * Tiny env loader for scripts and tests (Next.js loads .env itself at runtime).
 * Reads `.env` from the project root via dotenv, then returns the variables this
 * backend expects. Variable names are OURS (see .env.example) — keep .env aligned.
 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

let loaded = false;

export function loadEnv() {
  if (!loaded) {
    config({ path: join(__dirname, "..", ".env") });
    loaded = true;
  }
  return {
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET,
  };
}
