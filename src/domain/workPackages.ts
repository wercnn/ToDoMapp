/**
 * Work packages — the planning unit (api-endpoints.md §7). Mid-flight additions
 * are normal: when confirmed roadmap days exist, create emits a pending
 * `new_work_package` replan_proposal instead of silently touching the roadmap
 * (Principle 1). The WP insert and the proposal are written in ONE transaction.
 *
 * A freshly-created WP has no tasks yet, so the analyzed diff is typically empty —
 * the proposal's value is the audit-trail record + pending status; concrete moves
 * appear once tasks are added and the user re-runs a replan.
 */
import type { Kysely } from "kysely";
import type { Database, DifficultyLevel, ReplanProposal, WorkPackage } from "../db/types";
import type { AuthContext } from "../auth/context";
import { notFound } from "../lib/errors";
import { withTransaction } from "../db/transaction";
import { validateTitle, validateEstimate, validateTimeFixed } from "./validation";
import { getBlockedTaskIds } from "./blocked";
import { analyzeReplan } from "./replan/analyze";
import { createProposalInTx } from "./replan/proposals";

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

  return withTransaction(db, async (trx) => {
    const workPackage = await trx
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

    // If a confirmed roadmap exists, surface a pending proposal rather than
    // silently rewriting the plan (api §7, Principle 1).
    const confirmedDay = await trx
      .selectFrom("daily_plan_day")
      .select("id")
      .where("workspace_id", "=", ctx.workspaceId)
      .where("status", "=", "confirmed")
      .limit(1)
      .executeTakeFirst();
    if (!confirmedDay) return { work_package: workPackage };

    const { summary, changes } = await analyzeReplan(trx, ctx, {
      scope: { project_id: projectId },
      now,
    });
    const replan_proposal = await createProposalInTx(trx, ctx, {
      trigger: "new_work_package",
      summary,
      changes,
      now,
    });
    return { work_package: workPackage, replan_proposal };
  });
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
