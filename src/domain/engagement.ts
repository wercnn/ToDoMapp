/**
 * Engagement + streak maintenance (Decision #8: the streak is kept by opening &
 * engaging with the plan, not by completing work). Every ⚡eng endpoint calls
 * `recordEngagement` (idempotent upsert of today's local engagement_day) and then
 * `refreshStats` to rebuild the user_stats cache in the same transaction
 * (invariant #7). user_stats is always rebuildable from point_event + engagement_day.
 */
import type { Transaction } from "kysely";
import type { Database } from "../db/types";
import { addDays } from "../lib/dates";

/** Idempotent: records today's (local) engagement; same-day repeats are no-ops. */
export async function recordEngagement(
  trx: Transaction<Database>,
  args: { userId: string; workspaceId: string; localDate: string; now: Date },
): Promise<void> {
  await trx
    .insertInto("engagement_day")
    .values({
      user_id: args.userId,
      workspace_id: args.workspaceId,
      activity_date: args.localDate,
      first_engaged_at: args.now,
    })
    .onConflict((oc) => oc.columns(["user_id", "activity_date"]).doNothing())
    .execute();
}

/** Current streak = run of consecutive days ending today or yesterday. */
export function computeStreak(
  activityDatesDesc: string[],
  localToday: string,
): { current: number; longest: number } {
  if (activityDatesDesc.length === 0) return { current: 0, longest: 0 };

  const set = new Set(activityDatesDesc);

  // Current streak: only "alive" if engaged today or yesterday.
  let current = 0;
  let anchor: string | null = null;
  if (set.has(localToday)) anchor = localToday;
  else if (set.has(addDays(localToday, -1))) anchor = addDays(localToday, -1);
  if (anchor) {
    let cursor = anchor;
    while (set.has(cursor)) {
      current++;
      cursor = addDays(cursor, -1);
    }
  }

  // Longest run anywhere in the history.
  const sortedAsc = [...set].sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sortedAsc) {
    run = prev !== null && addDays(prev, 1) === d ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = d;
  }

  return { current, longest };
}

/** Recompute total_points + streak fields into user_stats (upsert). */
export async function refreshStats(
  trx: Transaction<Database>,
  args: { userId: string; workspaceId: string; localToday: string; now: Date },
): Promise<void> {
  const pointsRow = await trx
    .selectFrom("point_event")
    .select((eb) => eb.fn.coalesce(eb.fn.sum<number>("points"), eb.lit(0)).as("total"))
    .where("user_id", "=", args.userId)
    .executeTakeFirst();
  const totalPoints = Number(pointsRow?.total ?? 0);

  const dayRows = await trx
    .selectFrom("engagement_day")
    .select("activity_date")
    .where("user_id", "=", args.userId)
    .orderBy("activity_date", "desc")
    .execute();
  const dates = dayRows.map((r) => r.activity_date);
  const { current, longest } = computeStreak(dates, args.localToday);
  const lastEngaged = dates[0] ?? null;

  await trx
    .insertInto("user_stats")
    .values({
      user_id: args.userId,
      workspace_id: args.workspaceId,
      total_points: totalPoints,
      current_streak: current,
      longest_streak: longest,
      last_engaged_date: lastEngaged,
      updated_at: args.now,
    })
    .onConflict((oc) =>
      oc.column("user_id").doUpdateSet({
        total_points: totalPoints,
        current_streak: current,
        longest_streak: longest,
        last_engaged_date: lastEngaged,
        updated_at: args.now,
      }),
    )
    .execute();
}
