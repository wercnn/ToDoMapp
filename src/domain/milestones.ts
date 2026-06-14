/**
 * Milestones — named checkpoints = sets of work packages (api-endpoints.md §6,
 * Decision #5). Membership lives on `work_package.milestone_id`; a milestone is
 * assembled by PATCHing WPs onto it, not by listing WPs here.
 *
 * CRUD only. `achieved_at` is NEVER writable through this module — it is set
 * exactly once by the task-completion cascade (completion.ts §8) so celebration +
 * the milestone_achieved point event fire once. DELETE relies on the composite FK
 * `ON DELETE SET NULL (milestone_id)`: removing a milestone UNGROUPS its work
 * packages (nulls their milestone_id), it never deletes work (data-model §4.2).
 *
 * `projected_date` in the list read comes from the shared `projectMilestoneDates`
 * — the SAME source flow/roadmap/nudges derive milestone dates from, so they agree.
 */
import type { Kysely } from "kysely";
import type { Database, Milestone } from "../db/types";
import type { AuthContext } from "../auth/context";
import { badRequest, notFound } from "../lib/errors";
import { validateTitle } from "./validation";
import { projectMilestoneDates } from "./projection";

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

export interface MilestoneWithState extends Milestone {
  achieved: boolean;
  projected_date: string | null;
  wp_done: number;
  wp_total: number;
}

export async function listMilestones(
  db: Kysely<Database>,
  ctx: AuthContext,
  projectId: string,
  now: Date = new Date(),
): Promise<MilestoneWithState[]> {
  await assertProjectInWorkspace(db, ctx, projectId);

  const milestones = await db
    .selectFrom("milestone")
    .selectAll()
    .where("workspace_id", "=", ctx.workspaceId)
    .where("project_id", "=", projectId)
    .orderBy("position")
    .orderBy("created_at")
    .execute();
  if (milestones.length === 0) return [];

  // WP membership counts (wp_total / wp_done) per milestone.
  const wps = await db
    .selectFrom("work_package")
    .select(["milestone_id", "completed_at"])
    .where("workspace_id", "=", ctx.workspaceId)
    .where("project_id", "=", projectId)
    .where("milestone_id", "is not", null)
    .execute();
  const counts = new Map<string, { total: number; done: number }>();
  for (const wp of wps) {
    if (!wp.milestone_id) continue;
    const c = counts.get(wp.milestone_id) ?? { total: 0, done: 0 };
    c.total++;
    if (wp.completed_at != null) c.done++;
    counts.set(wp.milestone_id, c);
  }

  // projected_date — the shared projection (single source).
  const projected = await projectMilestoneDates(db, ctx, { now });

  return milestones.map((m) => {
    const c = counts.get(m.id) ?? { total: 0, done: 0 };
    return {
      ...m,
      achieved: m.achieved_at != null,
      projected_date: projected.get(m.id) ?? null,
      wp_done: c.done,
      wp_total: c.total,
    };
  });
}

export interface CreateMilestoneInput {
  id?: string;
  title: unknown;
  description?: string | null;
  position?: number;
}

export async function createMilestone(
  db: Kysely<Database>,
  ctx: AuthContext,
  projectId: string,
  input: CreateMilestoneInput,
): Promise<Milestone> {
  await assertProjectInWorkspace(db, ctx, projectId);
  const title = validateTitle(input.title);

  return db
    .insertInto("milestone")
    .values({
      ...(input.id ? { id: input.id } : {}),
      workspace_id: ctx.workspaceId,
      project_id: projectId,
      title,
      description: input.description ?? null,
      ...(input.position != null ? { position: input.position } : {}),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export interface UpdateMilestoneInput {
  title?: unknown;
  description?: string | null;
  position?: number;
}

export async function updateMilestone(
  db: Kysely<Database>,
  ctx: AuthContext,
  milestoneId: string,
  input: UpdateMilestoneInput,
): Promise<Milestone> {
  const patch: { title?: string; description?: string | null; position?: number; updated_at: Date } = {
    updated_at: new Date(),
  };
  if (input.title !== undefined) patch.title = validateTitle(input.title);
  if (input.description !== undefined) patch.description = input.description;
  if (input.position !== undefined) {
    if (!Number.isInteger(input.position)) throw badRequest("position must be an integer");
    patch.position = input.position;
  }

  const updated = await db
    .updateTable("milestone")
    .set(patch)
    .where("id", "=", milestoneId)
    .where("workspace_id", "=", ctx.workspaceId)
    .returningAll()
    .executeTakeFirst();
  if (!updated) throw notFound("Milestone not found");
  return updated;
}

/** Delete a milestone WITHOUT deleting its work. The composite FK SET NULL nulls
 *  each member WP's `milestone_id` (ungroup) — the app does no manual WP touch. */
export async function deleteMilestone(
  db: Kysely<Database>,
  ctx: AuthContext,
  milestoneId: string,
): Promise<void> {
  const result = await db
    .deleteFrom("milestone")
    .where("id", "=", milestoneId)
    .where("workspace_id", "=", ctx.workspaceId)
    .executeTakeFirst();
  if (Number(result.numDeletedRows) === 0) throw notFound("Milestone not found");
}
