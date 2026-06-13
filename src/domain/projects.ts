/**
 * Projects — initiatives under a goal carrying the per-project capacity
 * (api-endpoints.md §5). Capacity is validated 0 < c ≤ 24 (Decision #12).
 */
import type { Kysely } from "kysely";
import type { Database, Project, ProjectStatus } from "../db/types";
import type { AuthContext } from "../auth/context";
import { badRequest, notFound } from "../lib/errors";
import { validateTitle } from "./validation";
import { isValidDateString } from "../lib/dates";

/** Verify a goal is in the caller's workspace (else 404 — cross-workspace hidden). */
async function assertGoalInWorkspace(
  db: Kysely<Database>,
  ctx: AuthContext,
  goalId: string,
): Promise<void> {
  const goal = await db
    .selectFrom("goal")
    .select("id")
    .where("id", "=", goalId)
    .where("workspace_id", "=", ctx.workspaceId)
    .executeTakeFirst();
  if (!goal) throw notFound("Goal not found");
}

export interface CreateProjectInput {
  id?: string;
  title: unknown;
  description?: string | null;
  capacity_hours_per_day: unknown;
  target_end_date?: string | null;
  position?: number;
}

export async function createProject(
  db: Kysely<Database>,
  ctx: AuthContext,
  goalId: string,
  input: CreateProjectInput,
): Promise<Project> {
  await assertGoalInWorkspace(db, ctx, goalId);
  const title = validateTitle(input.title);

  const capacity = Number(input.capacity_hours_per_day);
  if (!Number.isFinite(capacity) || capacity <= 0 || capacity > 24) {
    throw badRequest("capacity_hours_per_day must be a number in (0, 24]");
  }
  if (input.target_end_date != null && !isValidDateString(input.target_end_date)) {
    throw badRequest("target_end_date must be a valid YYYY-MM-DD date");
  }

  return db
    .insertInto("project")
    .values({
      ...(input.id ? { id: input.id } : {}),
      workspace_id: ctx.workspaceId,
      goal_id: goalId,
      title,
      description: input.description ?? null,
      capacity_hours_per_day: capacity,
      target_end_date: input.target_end_date ?? null,
      ...(input.position != null ? { position: input.position } : {}),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function listProjects(
  db: Kysely<Database>,
  ctx: AuthContext,
  goalId: string,
  filters: { status?: ProjectStatus } = {},
): Promise<Project[]> {
  await assertGoalInWorkspace(db, ctx, goalId);
  let q = db
    .selectFrom("project")
    .selectAll()
    .where("workspace_id", "=", ctx.workspaceId)
    .where("goal_id", "=", goalId);
  if (filters.status) q = q.where("status", "=", filters.status);
  return q.orderBy("position").orderBy("created_at").execute();
}
