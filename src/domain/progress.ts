/**
 * Progress roll-ups (api-endpoints.md §4/§5, data-model §6). The ONE place that
 * computes "% done + estimate sums" over a scope's descendant tasks — backs
 * `GET /goals/{id}/progress`, `GET /projects/{id}/progress`, and the
 * `?include=progress` expansion on the goal/project GET-ones. Never stored.
 *
 * `percent_done` is TASK-COUNT based (tasks_done / tasks_total), not estimate-
 * weighted: estimates are nullable in our model, so a weighted percent would skew
 * or break on partial data. The known tradeoff is that a 5-minute task and a
 * 3-day task count equally — but `estimate_*_hours` ship in the same payload, so a
 * client wanting a weighted view can compute it. Estimate sums use the same
 * `resolveHours` (difficulty→nominal hours) the flow diagram uses, so the two
 * agree by construction.
 */
import type { Kysely } from "kysely";
import type { Database } from "../db/types";
import type { AuthContext } from "../auth/context";
import { notFound } from "../lib/errors";
import { resolveHours } from "../planner/constants";

export interface Progress {
  percent_done: number;
  tasks_done: number;
  tasks_total: number;
  estimate_done_hours: number;
  estimate_total_hours: number;
}

interface TaskRow {
  status: "todo" | "done";
  estimate_hours: string | null;
  difficulty: "low" | "mid" | "high" | null;
}

/** Pure: fold descendant task rows into the progress shape. */
function rollup(rows: TaskRow[]): Progress {
  let tasksDone = 0;
  let estimateTotal = 0;
  let estimateDone = 0;
  for (const t of rows) {
    const hours = resolveHours(t.estimate_hours != null ? Number(t.estimate_hours) : null, t.difficulty);
    estimateTotal += hours;
    if (t.status === "done") {
      tasksDone++;
      estimateDone += hours;
    }
  }
  const tasksTotal = rows.length;
  return {
    percent_done: tasksTotal > 0 ? Math.round((tasksDone / tasksTotal) * 100) : 0,
    tasks_done: tasksDone,
    tasks_total: tasksTotal,
    estimate_done_hours: estimateDone,
    estimate_total_hours: estimateTotal,
  };
}

export async function computeGoalProgress(
  db: Kysely<Database>,
  ctx: AuthContext,
  goalId: string,
): Promise<Progress> {
  const goal = await db
    .selectFrom("goal")
    .select("id")
    .where("id", "=", goalId)
    .where("workspace_id", "=", ctx.workspaceId)
    .executeTakeFirst();
  if (!goal) throw notFound("Goal not found");

  const rows = await db
    .selectFrom("task as t")
    .innerJoin("work_package as wp", "wp.id", "t.work_package_id")
    .innerJoin("project as p", "p.id", "wp.project_id")
    .select(["t.status", "t.estimate_hours", "t.difficulty"])
    .where("t.workspace_id", "=", ctx.workspaceId)
    .where("p.goal_id", "=", goalId)
    .execute();
  return rollup(rows);
}

export async function computeProjectProgress(
  db: Kysely<Database>,
  ctx: AuthContext,
  projectId: string,
): Promise<Progress> {
  const project = await db
    .selectFrom("project")
    .select("id")
    .where("id", "=", projectId)
    .where("workspace_id", "=", ctx.workspaceId)
    .executeTakeFirst();
  if (!project) throw notFound("Project not found");

  const rows = await db
    .selectFrom("task as t")
    .innerJoin("work_package as wp", "wp.id", "t.work_package_id")
    .select(["t.status", "t.estimate_hours", "t.difficulty"])
    .where("t.workspace_id", "=", ctx.workspaceId)
    .where("wp.project_id", "=", projectId)
    .execute();
  return rollup(rows);
}
