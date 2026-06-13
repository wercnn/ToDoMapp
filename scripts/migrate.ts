/**
 * Migration runner — applies the plain-SQL files in supabase/migrations against
 * the DIRECT connection (port 5432), in filename order, each in its own
 * transaction. Applied files are recorded in `schema_migrations` so re-runs are
 * idempotent. This is the Supabase-CLI file layout without requiring Docker/login.
 *
 *   npm run migrate            # apply all pending migrations
 *   npm run migrate -- --status  # list applied vs pending, apply nothing
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "pg";
import { loadEnv } from "./env";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");

async function main() {
  const statusOnly = process.argv.includes("--status");
  const env = loadEnv();
  const connectionString = env.DIRECT_URL;
  if (!connectionString) {
    throw new Error(
      "DIRECT_URL is not set. Migrations need the DIRECT connection (port 5432). See .env.example.",
    );
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text        PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    const { rows } = await client.query<{ version: string }>(
      "SELECT version FROM schema_migrations",
    );
    const applied = new Set(rows.map((r) => r.version));
    const pending = files.filter((f) => !applied.has(f));

    if (statusOnly) {
      console.log("Applied migrations:");
      for (const f of files) {
        console.log(`  ${applied.has(f) ? "✓" : "·"} ${f}`);
      }
      console.log(`\n${pending.length} pending.`);
      return;
    }

    if (pending.length === 0) {
      console.log("No pending migrations. Database is up to date.");
      return;
    }

    for (const file of pending) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      console.log(`Applying ${file} …`);
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`  ✓ ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
    }
    console.log(`\nDone. Applied ${pending.length} migration(s).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
