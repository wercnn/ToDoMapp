/**
 * Scoring ledger writes. The ONE rule here: each source (task / daily goal /
 * milestone) scores exactly once, EVER (data-model §4.6, invariant #8). This is
 * the belt-and-suspenders guard — an application existence check PLUS the partial
 * unique indexes on point_event. Re-completing a reopened task can never farm
 * points.
 *
 * `points_awarded` returned by these helpers is 0 when the source was already
 * scored, so callers can sum it into their response honestly.
 */
import type { Transaction } from "kysely";
import type { Database, PointEventType } from "../db/types";

type SourceColumn = "task_id" | "daily_plan_day_id" | "milestone_id";

type Source =
  | { task_id: string }
  | { daily_plan_day_id: string }
  | { milestone_id: string };

const SOURCE_COLUMN: Record<PointEventType, SourceColumn> = {
  task_completed: "task_id",
  daily_goal_completed: "daily_plan_day_id",
  milestone_achieved: "milestone_id",
};

/** Is this Postgres unique-violation? (the partial-unique backstop firing) */
function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === "23505";
}

/**
 * Insert a point_event for `eventType`/`source` exactly once. Returns the points
 * awarded (0 if the source was already scored). Must run inside the completion
 * transaction so the award and its side effects commit atomically.
 */
export async function awardOnce(
  trx: Transaction<Database>,
  args: { workspaceId: string; userId: string; eventType: PointEventType; source: Source; now: Date },
): Promise<number> {
  const { workspaceId, userId, eventType, source, now } = args;
  const column = SOURCE_COLUMN[eventType];
  const sourceId = (source as Record<string, string>)[column]!;

  // Application-side idempotency check (the first line of the guard).
  const existing = await trx
    .selectFrom("point_event")
    .select("id")
    .where(column, "=", sourceId)
    .executeTakeFirst();
  if (existing) return 0;

  const rule = await trx
    .selectFrom("point_rule")
    .select("points")
    .where("event_type", "=", eventType)
    .executeTakeFirst();
  if (!rule) {
    throw new Error(`point_rule missing for ${eventType} — did the seed migration run?`);
  }

  try {
    await trx
      .insertInto("point_event")
      .values({
        workspace_id: workspaceId,
        user_id: userId,
        event_type: eventType,
        points: rule.points,
        task_id: null,
        daily_plan_day_id: null,
        milestone_id: null,
        ...source,
        occurred_at: now,
      })
      .execute();
    return rule.points;
  } catch (err) {
    // The DB-level partial unique index fired — a concurrent award won the race.
    // Idempotent: treat as already-scored, award nothing more.
    if (isUniqueViolation(err)) return 0;
    throw err;
  }
}
