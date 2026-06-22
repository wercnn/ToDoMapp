/**
 * Real-plan completion dates — the replacement for the old read-only projection
 * (`projectMilestoneDates`). Every task now always sits on a concrete day (new work
 * lands on tomorrow; replan moves it), so a milestone's "projected finish" is simply
 * the LATEST day any of its still-open tasks is scheduled on — read straight from the
 * plan, with no planner involved. Honest by construction: `null` when none of the
 * milestone's open tasks are scheduled (the signal to replan), not a fabricated date.
 *
 * Drop-in for `projectMilestoneDates(db, ctx, { now?, goalId? })`.
 */
import type { Kysely } from "kysely";
import type { Database } from "../db/types";
import type { WorkspaceContext } from "../auth/context";

/** taskId → latest non-slipped planned/completed plan date (the task's scheduled day). */
async function scheduledTaskDates(
  db: Kysely<Database>,
  workspaceId: string,
): Promise<Map<string, string>> {
  const rows = await db
    .selectFrom("daily_plan_item as i")
    .innerJoin("daily_plan_day as d", "d.id", "i.daily_plan_day_id")
    .select((eb) => ["i.task_id as taskId", eb.fn.max("d.plan_date").as("date")])
    .where("i.workspace_id", "=", workspaceId)
    .where("i.status", "in", ["planned", "completed"])
    .where("d.status", "<>", "slipped")
    .where("i.task_id", "is not", null)
    .groupBy("i.task_id")
    .execute();
  const map = new Map<string, string>();
  for (const r of rows) if (r.taskId && r.date) map.set(r.taskId, r.date);
  return map;
}

/**
 * milestoneId → latest scheduled day among its OPEN tasks, or null when none of them
 * are scheduled. Replaces `projectMilestoneDates`.
 */
export async function scheduledMilestoneDates(
  db: Kysely<Database>,
  ctx: WorkspaceContext,
  opts: { now?: Date; goalId?: string } = {},
): Promise<Map<string, string | null>> {
  let taskQ = db
    .selectFrom("task as t")
    .innerJoin("work_package as wp", "wp.id", "t.work_package_id")
    .innerJoin("project as p", "p.id", "wp.project_id")
    .select(["t.id as taskId", "wp.milestone_id as milestoneId"])
    .where("t.workspace_id", "=", ctx.workspaceId)
    .where("t.status", "=", "todo")
    .where("t.replaced_at", "is", null)
    .where("p.status", "=", "active")
    .where("wp.completed_at", "is", null)
    .where("wp.milestone_id", "is not", null);
  if (opts.goalId) taskQ = taskQ.where("p.goal_id", "=", opts.goalId);
  const tasks = await taskQ.execute();

  const taskDate = await scheduledTaskDates(db, ctx.workspaceId);

  const result = new Map<string, string | null>();
  for (const t of tasks) {
    const milestoneId = t.milestoneId;
    if (!milestoneId) continue;
    if (!result.has(milestoneId)) result.set(milestoneId, null);
    const date = taskDate.get(t.taskId);
    if (!date) continue;
    const cur = result.get(milestoneId) ?? null;
    if (cur === null || date > cur) result.set(milestoneId, date);
  }
  return result;
}
