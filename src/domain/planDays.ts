/**
 * One source of truth for the "confirmed day" shape.
 *
 * `daily_plan_day` has NO DB CHECK tying `status` to `confirmed_at` — the schema
 * comment states that consistency is API-maintained by design (a slipped day may
 * never have been confirmed). That decision relies on the API never producing an
 * inconsistent confirmed day, so the two places that produce one — `confirmDay`
 * (proposed → confirmed transition) and replan `apply` (inserting a fresh target
 * day) — MUST agree. They share the value set here rather than constructing it
 * independently "by convention."
 *
 * Note the operations still differ and are intentionally NOT merged: `confirmDay`
 * updates an EXISTING day and records ⚡eng; `apply` CREATES a new day. Only the
 * confirmed-status value set is shared.
 */
import type { Insertable } from "kysely";
import type { DailyPlanDay, DailyPlanDayTable } from "../db/types";
import type { Executor } from "../db/transaction";

/** The fields that define a confirmed day. Spread into an insert or an update. */
export function confirmedDayValues(now: Date): {
  status: "confirmed";
  confirmed_at: Date;
  updated_at: Date;
} {
  return { status: "confirmed", confirmed_at: now, updated_at: now };
}

/** Insert a brand-new confirmed day (the replan-apply create path). */
export function createConfirmedDay(
  db: Executor,
  workspaceId: string,
  planDate: string,
  now: Date,
): Promise<DailyPlanDay> {
  const values: Insertable<DailyPlanDayTable> = {
    workspace_id: workspaceId,
    plan_date: planDate,
    ...confirmedDayValues(now),
  };
  return db.insertInto("daily_plan_day").values(values).returningAll().executeTakeFirstOrThrow();
}
