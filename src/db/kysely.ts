/**
 * Kysely instance over the POOLED Supabase connection (port 6543). The Next.js
 * serverless runtime opens many short-lived connections, so the app must go
 * through the pooler; keep the local pg pool tiny. Migrations/tests use the
 * DIRECT connection via their own client (see scripts/, tests/).
 *
 * Supabase's auto-generated Data API is disabled — this Kysely instance is the
 * ONLY thing that reads/writes the domain tables.
 */
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { Database } from "./types";

const { Pool, types } = pg;

// Postgres `numeric` (OID 1700) parses to string by default — keep it that way
// so we never silently lose precision on hours/capacity. Callers convert
// explicitly where they need a number.
//
// Postgres `date` (OID 1082) defaults to a JS Date (local midnight), which both
// loses the calendar-date intent and breaks our string-based day-boundary logic
// (plan_date, activity_date, fixed_date…). Force it to the raw 'YYYY-MM-DD'
// string so runtime matches the `DateString` types and midnight-local math.
// setTypeParser is global to the pg module, so this applies to every connection.
types.setTypeParser(1082, (value: string) => value);

export function createDb(connectionString: string): Kysely<Database> {
  const pool = new Pool({
    connectionString,
    // Serverless: many functions, few connections each. The pooler fans out.
    max: 1,
    idleTimeoutMillis: 10_000,
  });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

let singleton: Kysely<Database> | null = null;

/** The app-wide pooled DB handle. Lazily built from DATABASE_URL. */
export function getDb(): Kysely<Database> {
  if (!singleton) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set (pooled connection). See .env.example.");
    }
    singleton = createDb(connectionString);
  }
  return singleton;
}

export type DB = Kysely<Database>;
// Re-export so callers can use the same numeric parsing knob if needed.
export { types as pgTypes };
