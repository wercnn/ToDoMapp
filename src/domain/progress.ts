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
    .where("t.replaced_at", "is", null)
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
    .where("t.replaced_at", "is", null)
    .execute();
  return rollup(rows);
}

/**
 * Batch progress for many projects in ONE descendant-task read (replaces the
 * per-project N+1 the Sidebar used to trigger via `listProjects?include=progress`).
 *
 * Fetches every descendant task once, tagged with its `project_id`, then folds
 * per project in JS with the SAME `resolveHours` — so the difficulty→hours
 * mapping stays the single source of truth (no SQL CASE duplication / drift).
 * Projects with no tasks aren't in the result set, so callers get the empty
 * `rollup([])` (0%, all zeros) — matching the single-project path on empty sets.
 *
 * No existence/workspace check per project: the caller already loaded the
 * projects (workspace-scoped), so the only guard needed is the `workspace_id`
 * filter here. Returns a Map keyed by project id; missing keys ⇒ empty progress.
 */
export async function computeProjectProgressBatch(
  db: Kysely<Database>,
  ctx: AuthContext,
  projectIds: string[],
): Promise<Map<string, Progress>> {
  const result = new Map<string, Progress>();
  for (const id of projectIds) result.set(id, rollup([])); // default empty (no-task projects)
  if (projectIds.length === 0) return result;

  const rows = await db
    .selectFrom("task as t")
    .innerJoin("work_package as wp", "wp.id", "t.work_package_id")
    .select(["wp.project_id", "t.status", "t.estimate_hours", "t.difficulty"])
    .where("t.workspace_id", "=", ctx.workspaceId)
    .where("wp.project_id", "in", projectIds)
    .where("t.replaced_at", "is", null)
    .execute();

  const byProject = new Map<string, TaskRow[]>();
  for (const row of rows) {
    const bucket = byProject.get(row.project_id) ?? [];
    bucket.push(row);
    byProject.set(row.project_id, bucket);
  }
  for (const [projectId, taskRows] of byProject) result.set(projectId, rollup(taskRows));
  return result;
}
