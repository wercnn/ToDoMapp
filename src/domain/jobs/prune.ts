/**
 * Stale-token pruning (api §13): drop push endpoints we haven't seen in a while, so
 * we stop shipping to dead tokens. Driven entirely by `device.last_seen_at`
 * (refreshed on every re-registration). Naturally idempotent — a re-run finds
 * nothing new past the cutoff.
 *
 * Conservative on NULLs: a device with no `last_seen_at` is left alone (we can't
 * date it). In practice registration always stamps `last_seen_at`.
 */
import type { Kysely } from "kysely";
import type { Database } from "../../db/types";

export const STALE_DEVICE_DAYS = 60;

export async function pruneStaleDevices(
  db: Kysely<Database>,
  now: Date = new Date(),
  thresholdDays: number = STALE_DEVICE_DAYS,
): Promise<number> {
  const cutoff = new Date(now.getTime() - thresholdDays * 24 * 60 * 60 * 1000);
  const res = await db
    .deleteFrom("device")
    .where("last_seen_at", "is not", null)
    .where("last_seen_at", "<", cutoff)
    .executeTakeFirst();
  return Number(res.numDeletedRows ?? 0n);
}
