/**
 * Derived blocked-state (data-model §6 — computed, never stored). A task is
 * blocked when:
 *   - any earlier active task in the same work package is incomplete, or
 *   - its work package has an incomplete upstream WORK PACKAGE (work_package_dependency).
 *
 * Blocked work is never schedulable or pull-forward-able. Manual task_dependency
 * rows are ignored; task order inside a work package is position-based.
 */
import type { Executor } from "../db/transaction";
import type { WorkspaceContext } from "../auth/context";
import { derivePositionBlockedTaskIds } from "./taskPositionDependencies";

/** Ids of all currently-blocked tasks in the caller's workspace. */
export async function getBlockedTaskIds(
  db: Executor,
  ctx: WorkspaceContext,
): Promise<Set<string>> {
  const tasks = await db
    .selectFrom("task")
    .select(["id", "work_package_id", "position", "status", "replaced_at"])
    .where("workspace_id", "=", ctx.workspaceId)
    .where("replaced_at", "is", null)
    .execute();
  const taskLevel = derivePositionBlockedTaskIds(
    tasks.map((task) => ({
      id: task.id,
      workPackageId: task.work_package_id,
      position: task.position,
      status: task.status,
      replacedAt: task.replaced_at,
    })),
  );

  const wpLevel = await db
    .selectFrom("work_package_dependency as wd")
    .innerJoin("work_package as pred_wp", "pred_wp.id", "wd.predecessor_wp_id")
    .innerJoin("task as t", "t.work_package_id", "wd.successor_wp_id")
    .select("t.id as id")
    .where("wd.workspace_id", "=", ctx.workspaceId)
    .where("pred_wp.completed_at", "is", null)
    .where("t.replaced_at", "is", null)
    .where("t.status", "<>", "done")
    .execute();

  return new Set([...taskLevel, ...wpLevel.map((r) => r.id)]);
}
