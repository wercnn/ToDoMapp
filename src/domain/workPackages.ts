/**
 * Work packages — the planning unit (api-endpoints.md §7). Mid-flight additions
 * are direct edits: creating a WP never creates a replan proposal. The user can
 * request a manual replan after adding or editing work.
 */
import type { Kysely } from "kysely";
import type { Database, DifficultyLevel, ReplanProposal, Task, WorkPackage } from "../db/types";
import type { AuthContext } from "../auth/context";
import { badRequest, notFound } from "../lib/errors";
import { validateTitle, validateEstimate, validateTimeFixed } from "./validation";
import { getBlockedTaskIds } from "./blocked";

async function assertProjectInWorkspace(
  db: Kysely<Database>,
  ctx: AuthContext,
  projectId: string,
): Promise<void> {
  const project = await db
    .selectFrom("project")
    .select("id")
    .where("id", "=", projectId)
    .where("workspace_id", "=", ctx.workspaceId)
    .executeTakeFirst();
  if (!project) throw notFound("Project not found");
}

/** Milestone must exist in the SAME project (the composite FK also enforces this). */
async function assertMilestoneInProject(
  db: Kysely<Database>,
  ctx: AuthContext,
  projectId: string,
  milestoneId: string,
): Promise<void> {
  const ms = await db
    .selectFrom("milestone")
    .select("id")
    .where("id", "=", milestoneId)
    .where("project_id", "=", projectId)
    .where("workspace_id", "=", ctx.workspaceId)
    .executeTakeFirst();
  if (!ms) throw notFound("Milestone not found in this project");
}

export interface CreateWorkPackageInput {
  id?: string;
  title: unknown;
  description?: string | null;
  milestone_id?: string | null;
  estimate_hours?: number | null;
  difficulty?: DifficultyLevel | null;
  is_time_fixed?: boolean;
  fixed_date?: string | null;
  position?: number;
}

export interface CreateWorkPackageResult {
  work_package: WorkPackage;
  replan_proposal?: ReplanProposal;
}

export async function createWorkPackage(
  db: Kysely<Database>,
  ctx: AuthContext,
  projectId: string,
  input: CreateWorkPackageInput,
  now: Date = new Date(),
): Promise<CreateWorkPackageResult> {
  await assertProjectInWorkspace(db, ctx, projectId);
  const title = validateTitle(input.title);
  validateEstimate(input);
  validateTimeFixed(input);
  if (input.milestone_id) {
    await assertMilestoneInProject(db, ctx, projectId, input.milestone_id);
  }

  void now;
  const workPackage = await db
    .insertInto("work_package")
    .values({
      ...(input.id ? { id: input.id } : {}),
      workspace_id: ctx.workspaceId,
      project_id: projectId,
      milestone_id: input.milestone_id ?? null,
      title,
      description: input.description ?? null,
      estimate_hours: input.estimate_hours ?? null,
      difficulty: input.difficulty ?? null,
      is_time_fixed: input.is_time_fixed ?? false,
      fixed_date: input.fixed_date ?? null,
      ...(input.position != null ? { position: input.position } : {}),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return { work_package: workPackage };
}

export type WorkPackageStatus = "open" | "in_progress" | "done" | "blocked";

export interface WorkPackageWithStatus extends WorkPackage {
  derived_status: WorkPackageStatus;
}

export async function listWorkPackages(
  db: Kysely<Database>,
  ctx: AuthContext,
  projectId: string,
  filters: { milestoneId?: string; openOnly?: boolean } = {},
): Promise<WorkPackageWithStatus[]> {
  await assertProjectInWorkspace(db, ctx, projectId);

  let q = db
    .selectFrom("work_package")
    .selectAll()
    .where("workspace_id", "=", ctx.workspaceId)
    .where("project_id", "=", projectId);
  if (filters.milestoneId) q = q.where("milestone_id", "=", filters.milestoneId);
  if (filters.openOnly) q = q.where("completed_at", "is", null);
  const wps = await q.orderBy("position").orderBy("created_at").execute();

  // Derived status (data-model §6). Aggregate child-task states per WP.
  const wpIds = wps.map((w) => w.id);
  const taskAgg = new Map<string, { total: number; done: number }>();
  if (wpIds.length > 0) {
    const tasks = await db
      .selectFrom("task")
      .select(["work_package_id", "status"])
      .where("workspace_id", "=", ctx.workspaceId)
      .where("work_package_id", "in", wpIds)
      .where("replaced_at", "is", null)
      .execute();
    for (const t of tasks) {
      const agg = taskAgg.get(t.work_package_id) ?? { total: 0, done: 0 };
      agg.total++;
      if (t.status === "done") agg.done++;
      taskAgg.set(t.work_package_id, agg);
    }
  }
  const blocked = await getBlockedTaskIds(db, ctx);
  const blockedWpIds = new Set<string>();
  if (wpIds.length > 0 && blocked.size > 0) {
    const blockedTasks = await db
      .selectFrom("task")
      .select(["id", "work_package_id"])
      .where("work_package_id", "in", wpIds)
      .where("replaced_at", "is", null)
      .execute();
    for (const t of blockedTasks) {
      if (blocked.has(t.id)) blockedWpIds.add(t.work_package_id);
    }
  }

  return wps.map((wp) => {
    let status: WorkPackageStatus;
    if (wp.completed_at) status = "done";
    else if (blockedWpIds.has(wp.id)) status = "blocked";
    else {
      const agg = taskAgg.get(wp.id);
      status = agg && agg.done > 0 ? "in_progress" : "open";
    }
    return { ...wp, derived_status: status };
  });
}

async function findWorkPackage(
  db: Kysely<Database>,
  ctx: AuthContext,
  wpId: string,
): Promise<WorkPackage> {
  const wp = await db
    .selectFrom("work_package")
    .selectAll()
    .where("id", "=", wpId)
    .where("workspace_id", "=", ctx.workspaceId)
    .executeTakeFirst();
  if (!wp) throw notFound("Work package not found");
  return wp;
}

export interface WorkPackageWithTasks extends WorkPackage {
  tasks: Task[];
}

export async function getWorkPackage(
  db: Kysely<Database>,
  ctx: AuthContext,
  wpId: string,
  opts: { includeTasks?: boolean } = {},
): Promise<WorkPackage | WorkPackageWithTasks> {
  const wp = await findWorkPackage(db, ctx, wpId);
  if (!opts.includeTasks) return wp;
  const tasks = await db
    .selectFrom("task")
    .selectAll()
    .where("workspace_id", "=", ctx.workspaceId)
    .where("work_package_id", "=", wpId)
    .where("replaced_at", "is", null)
    .orderBy("position")
    .orderBy("created_at")
    .execute();
  return { ...wp, tasks };
}

export interface UpdateWorkPackageInput {
  title?: unknown;
  description?: string | null;
  milestone_id?: string | null;
  estimate_hours?: number | null;
  difficulty?: DifficultyLevel | null;
  is_time_fixed?: boolean;
  fixed_date?: string | null;
  position?: number;
}

export async function updateWorkPackage(
  db: Kysely<Database>,
  ctx: AuthContext,
  wpId: string,
  input: UpdateWorkPackageInput,
): Promise<WorkPackage> {
  const existing = await findWorkPackage(db, ctx, wpId);

  // Validate the MERGED estimate / time-fixed state (same rules as create) so the
  // either/or + pairing invariants hold across a partial patch. DB CHECKs backstop.
  const effEstimate =
    input.estimate_hours !== undefined
      ? input.estimate_hours
      : existing.estimate_hours != null
        ? Number(existing.estimate_hours)
        : null;
  const effDifficulty = input.difficulty !== undefined ? input.difficulty : existing.difficulty;
  validateEstimate({ estimate_hours: effEstimate, difficulty: effDifficulty });

  const effIsFixed = input.is_time_fixed !== undefined ? input.is_time_fixed : existing.is_time_fixed;
  const effFixedDate = input.fixed_date !== undefined ? input.fixed_date : existing.fixed_date;
  validateTimeFixed({ is_time_fixed: effIsFixed, fixed_date: effFixedDate });

  if (input.milestone_id) {
    await assertMilestoneInProject(db, ctx, existing.project_id, input.milestone_id);
  }

  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (input.title !== undefined) patch.title = validateTitle(input.title);
  if (input.description !== undefined) patch.description = input.description;
  if (input.milestone_id !== undefined) patch.milestone_id = input.milestone_id;
  if (input.estimate_hours !== undefined) patch.estimate_hours = input.estimate_hours;
  if (input.difficulty !== undefined) patch.difficulty = input.difficulty;
  if (input.is_time_fixed !== undefined) patch.is_time_fixed = input.is_time_fixed;
  if (input.fixed_date !== undefined) patch.fixed_date = input.fixed_date;
  if (input.position !== undefined) {
    if (!Number.isInteger(input.position)) throw badRequest("position must be an integer");
    patch.position = input.position;
  }

  return db
    .updateTable("work_package")
    .set(patch)
    .where("id", "=", wpId)
    .where("workspace_id", "=", ctx.workspaceId)
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** Delete a WP and its tasks/dep edges/plan items via FK ON DELETE CASCADE.
 *  Ledger rows survive (sources ON DELETE SET NULL). No manual cascade. */
export async function deleteWorkPackage(
  db: Kysely<Database>,
  ctx: AuthContext,
  wpId: string,
): Promise<void> {
  const result = await db
    .deleteFrom("work_package")
    .where("id", "=", wpId)
    .where("workspace_id", "=", ctx.workspaceId)
    .executeTakeFirst();
  if (Number(result.numDeletedRows) === 0) throw notFound("Work package not found");
}
