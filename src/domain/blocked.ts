/**
 * Derived blocked-state (data-model §6 — computed, never stored). A task is
 * blocked when:
 *   - any predecessor TASK is incomplete (task_dependency), or
 *   - its work package has an incomplete upstream WORK PACKAGE (work_package_dependency).
 *
 * Blocked work is never schedulable or pull-forward-able. In this slice no
 * dependency edges exist yet, so this returns ∅ — but it is correct for when the
 * dependency endpoints land, and the planner already consumes it.
 */
import type { Executor } from "../db/transaction";
import type { WorkspaceContext } from "../auth/context";

/** Ids of all currently-blocked tasks in the caller's workspace. */
export async function getBlockedTaskIds(
  db: Executor,
  ctx: WorkspaceContext,
): Promise<Set<string>> {
  const taskLevel = await db
    .selectFrom("task_dependency as td")
    .innerJoin("task as pred", "pred.id", "td.predecessor_task_id")
    .select("td.successor_task_id as id")
    .where("td.workspace_id", "=", ctx.workspaceId)
    .where("pred.status", "<>", "done")
    .where("pred.replaced_at", "is", null)
    .execute();

  const wpLevel = await db
    .selectFrom("work_package_dependency as wd")
    .innerJoin("work_package as pred_wp", "pred_wp.id", "wd.predecessor_wp_id")
    .innerJoin("task as t", "t.work_package_id", "wd.successor_wp_id")
    .select("t.id as id")
    .where("wd.workspace_id", "=", ctx.workspaceId)
    .where("pred_wp.completed_at", "is", null)
    .where("t.replaced_at", "is", null)
    .execute();

  return new Set([...taskLevel, ...wpLevel].map((r) => r.id));
}
