/**
 * The single transaction helper. Every multi-table write in the system goes
 * through here so the completion cascade and replan-apply are all-or-nothing
 * (data-model invariant #7: caches are transactional).
 *
 * Domain functions accept an `Executor` — either the base Kysely handle or an
 * open transaction — so they compose: a handler opens ONE transaction and threads
 * the same `trx` through every step of the cascade.
 */
import type { Kysely, Transaction } from "kysely";
import type { Database } from "./types";

/** A Kysely handle that can run queries — the pool or an open transaction. */
export type Executor = Kysely<Database> | Transaction<Database>;

/** Run `fn` inside a single transaction; commit on success, roll back on throw. */
export function withTransaction<T>(
  db: Kysely<Database>,
  fn: (trx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(fn);
}
