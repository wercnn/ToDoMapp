/**
 * Points & history — the READ side of the motivation layer (api-endpoints.md §12).
 * All point_event writes happen inside the task-completion cascade (§8); there is
 * deliberately NO mutation endpoint here, and no penalty event type to query
 * (Principle 3). point_rule is read-only seed data.
 */
import type { Kysely } from "kysely";
import type { Database, PointEvent, PointEventType } from "../db/types";
import type { AuthContext } from "../auth/context";
import { addDays, zonedDayStart } from "../lib/dates";

export interface PointEventFilter {
  from?: string; // 'YYYY-MM-DD' inclusive, interpreted in the user's timezone
  to?: string; // 'YYYY-MM-DD' inclusive (through end-of-day local)
  eventType?: PointEventType;
}

/**
 * GET /point-events — append-only ledger read. Date bounds are resolved against
 * the user's timezone (invariant #3): `from` is local midnight that opens the day,
 * `to` runs through end-of-day local (i.e. strictly before the next local
 * midnight), so a range means whole LOCAL calendar days, not a UTC instant.
 */
export async function listPointEvents(
  db: Kysely<Database>,
  ctx: AuthContext,
  filter: PointEventFilter = {},
): Promise<PointEvent[]> {
  let q = db
    .selectFrom("point_event")
    .selectAll()
    .where("workspace_id", "=", ctx.workspaceId);

  if (filter.from) q = q.where("occurred_at", ">=", zonedDayStart(ctx.timezone, filter.from));
  if (filter.to) {
    q = q.where("occurred_at", "<", zonedDayStart(ctx.timezone, addDays(filter.to, 1)));
  }
  if (filter.eventType) q = q.where("event_type", "=", filter.eventType);

  return q.orderBy("occurred_at", "desc").execute();
}

/** GET /point-rules — current point values per event type (read-only seed). */
export async function listPointRules(
  db: Kysely<Database>,
  _ctx: AuthContext,
): Promise<{ event_type: PointEventType; points: number }[]> {
  return db.selectFrom("point_rule").select(["event_type", "points"]).orderBy("event_type").execute();
}
