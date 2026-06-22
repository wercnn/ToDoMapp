/**
 * Dependency edge compatibility APIs. Work-package edges remain the explicit
 * "must finish before" model. Task rows are retained for legacy/metadata use;
 * scheduling, blocked-state, and flow task edges derive order from task position
 * inside each work package.
 *
 * Acyclicity is an **API-layer** reachability check (§9.2 rule 6: no DB triggers).
 * Before inserting `pred → succ` we ask whether `succ` can already reach `pred`;
 * if so, the new edge would close a cycle → 409. The traversal is a BFS over the
 * workspace's edges of that level, so it catches transitive cycles, not just the
 * direct back-edge.
 *
 * Concurrency: two simultaneous inserts (A→B and B→A) could each pass the check
 * and both commit, creating a cycle the transaction alone can't prevent. We take a
 * transaction-scoped advisory lock keyed on (workspace, level) so edge-inserts
 * within one workspace+level serialize; the lock releases automatically on
 * commit/rollback and contends with nothing else.
 *
 * Duplicate edges are NOT pre-checked: the PK `(predecessor, successor)` is the
 * authoritative guard (23505 → 409 via lib/errors), so it can't race a concurrent
 * insert of the same edge.
 */
import { sql, type Kysely } from "kysely";
import type { Database, TaskDependency, WorkPackageDependency } from "../db/types";
import type { AuthContext } from "../auth/context";
import { withTransaction, type Executor } from "../db/transaction";
import { badRequest, conflict, notFound, unprocessable } from "../lib/errors";

// Advisory-lock sub-keys per dependency level (the high key is hashtext(workspace)).
const LOCK_LEVEL_TASK = 0;
const LOCK_LEVEL_WP = 1;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate a client-supplied id is a UUID string (else 400, not a DB 500). */
function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw badRequest(`${field} must be a UUID`);
  }
  return value;
}

/** Serialize edge-inserts within one workspace + level for the cycle window. */
async function acquireEdgeLock(
  trx: Executor,
  workspaceId: string,
  level: number,
): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtext(${workspaceId}), ${level})`.execute(
    trx,
  );
}

type Edge = { pred: string; succ: string };

/** BFS: following edges pred→succ, can we get from `from` to `target`? */
function reaches(edges: Edge[], from: string, target: string): boolean {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const outs = adj.get(e.pred);
    if (outs) outs.push(e.succ);
    else adj.set(e.pred, [e.succ]);
  }
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node === target) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of adj.get(node) ?? []) stack.push(next);
  }
  return false;
}

/** Both nodes must exist in the caller's workspace, else 404 (cross-ws indistinct). */
async function assertNodesInWorkspace(
  trx: Executor,
  workspaceId: string,
  table: "task" | "work_package",
  ids: string[],
): Promise<void> {
  const rows = await trx
    .selectFrom(table)
    .select("id")
    .where("workspace_id", "=", workspaceId)
    .where("id", "in", ids)
    .execute();
  if (rows.length !== ids.length) {
    throw notFound(table === "task" ? "Task not found" : "Work package not found");
  }
}

async function assertTasksInSameWorkPackage(
  trx: Executor,
  workspaceId: string,
  pred: string,
  succ: string,
): Promise<void> {
  const rows = await trx
    .selectFrom("task")
    .select(["id", "work_package_id"])
    .where("workspace_id", "=", workspaceId)
    .where("id", "in", [pred, succ])
    .execute();
  const byId = new Map(rows.map((r) => [r.id, r.work_package_id]));
  if (byId.get(pred) !== byId.get(succ)) {
    throw unprocessable("Task dependencies must stay inside the same work package");
  }
}

async function assertWorkPackagesInSameProject(
  trx: Executor,
  workspaceId: string,
  pred: string,
  succ: string,
): Promise<void> {
  const rows = await trx
    .selectFrom("work_package")
    .select(["id", "project_id"])
    .where("workspace_id", "=", workspaceId)
    .where("id", "in", [pred, succ])
    .execute();
  const byId = new Map(rows.map((r) => [r.id, r.project_id]));
  if (byId.get(pred) !== byId.get(succ)) {
    throw unprocessable("Work-package dependencies must stay inside the same project");
  }
}

// ---------------------------------------------------------------------------
// Task → task edges
// ---------------------------------------------------------------------------

export interface CreateTaskDependencyInput {
  predecessor_task_id: unknown;
  successor_task_id: unknown;
}

export async function createTaskDependency(
  db: Kysely<Database>,
  ctx: AuthContext,
  input: CreateTaskDependencyInput,
): Promise<TaskDependency> {
  const pred = requireUuid(input.predecessor_task_id, "predecessor_task_id");
  const succ = requireUuid(input.successor_task_id, "successor_task_id");
  if (pred === succ) throw unprocessable("A task cannot depend on itself");

  return withTransaction(db, async (trx) => {
    await acquireEdgeLock(trx, ctx.workspaceId, LOCK_LEVEL_TASK);
    await assertNodesInWorkspace(trx, ctx.workspaceId, "task", [pred, succ]);
    await assertTasksInSameWorkPackage(trx, ctx.workspaceId, pred, succ);

    const edges = await trx
      .selectFrom("task_dependency")
      .select(["predecessor_task_id as pred", "successor_task_id as succ"])
      .where("workspace_id", "=", ctx.workspaceId)
      .execute();
    if (reaches(edges, succ, pred)) {
      throw conflict("This edge would create a dependency cycle");
    }

    return trx
      .insertInto("task_dependency")
      .values({
        workspace_id: ctx.workspaceId,
        predecessor_task_id: pred,
        successor_task_id: succ,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  });
}

export async function deleteTaskDependency(
  db: Kysely<Database>,
  ctx: AuthContext,
  predecessorTaskId: string,
  successorTaskId: string,
): Promise<void> {
  await db
    .deleteFrom("task_dependency")
    .where("workspace_id", "=", ctx.workspaceId)
    .where("predecessor_task_id", "=", predecessorTaskId)
    .where("successor_task_id", "=", successorTaskId)
    .execute();
}

// ---------------------------------------------------------------------------
// Work-package → work-package edges
// ---------------------------------------------------------------------------

export interface CreateWorkPackageDependencyInput {
  predecessor_wp_id: unknown;
  successor_wp_id: unknown;
}

export async function createWorkPackageDependency(
  db: Kysely<Database>,
  ctx: AuthContext,
  input: CreateWorkPackageDependencyInput,
): Promise<WorkPackageDependency> {
  const pred = requireUuid(input.predecessor_wp_id, "predecessor_wp_id");
  const succ = requireUuid(input.successor_wp_id, "successor_wp_id");
  if (pred === succ) throw unprocessable("A work package cannot depend on itself");

  return withTransaction(db, async (trx) => {
    await acquireEdgeLock(trx, ctx.workspaceId, LOCK_LEVEL_WP);
    await assertNodesInWorkspace(trx, ctx.workspaceId, "work_package", [pred, succ]);
    await assertWorkPackagesInSameProject(trx, ctx.workspaceId, pred, succ);

    const edges = await trx
      .selectFrom("work_package_dependency")
      .select(["predecessor_wp_id as pred", "successor_wp_id as succ"])
      .where("workspace_id", "=", ctx.workspaceId)
      .execute();
    if (reaches(edges, succ, pred)) {
      throw conflict("This edge would create a dependency cycle");
    }

    return trx
      .insertInto("work_package_dependency")
      .values({
        workspace_id: ctx.workspaceId,
        predecessor_wp_id: pred,
        successor_wp_id: succ,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  });
}

export async function deleteWorkPackageDependency(
  db: Kysely<Database>,
  ctx: AuthContext,
  predecessorWpId: string,
  successorWpId: string,
): Promise<void> {
  await db
    .deleteFrom("work_package_dependency")
    .where("workspace_id", "=", ctx.workspaceId)
    .where("predecessor_wp_id", "=", predecessorWpId)
    .where("successor_wp_id", "=", successorWpId)
    .execute();
}
