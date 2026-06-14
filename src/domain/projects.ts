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
import { computeProjectProgress, type Progress } from "./progress";

const PROJECT_STATUSES: ProjectStatus[] = ["active", "completed", "archived"];

/** Capacity must be in (0, 24] (Decision #12). */
function validateCapacity(value: unknown): number {
  const capacity = Number(value);
  if (!Number.isFinite(capacity) || capacity <= 0 || capacity > 24) {
    throw badRequest("capacity_hours_per_day must be a number in (0, 24]");
  }
  return capacity;
}

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

  const capacity = validateCapacity(input.capacity_hours_per_day);
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

async function findProject(
  db: Kysely<Database>,
  ctx: AuthContext,
  projectId: string,
): Promise<Project> {
  const project = await db
    .selectFrom("project")
    .selectAll()
    .where("id", "=", projectId)
    .where("workspace_id", "=", ctx.workspaceId)
    .executeTakeFirst();
  if (!project) throw notFound("Project not found");
  return project;
}

export interface ProjectWithProgress extends Project {
  progress: Progress;
}

export async function getProject(
  db: Kysely<Database>,
  ctx: AuthContext,
  projectId: string,
  opts: { includeProgress?: boolean } = {},
): Promise<Project | ProjectWithProgress> {
  const project = await findProject(db, ctx, projectId);
  if (!opts.includeProgress) return project;
  return { ...project, progress: await computeProjectProgress(db, ctx, projectId) };
}

export interface UpdateProjectInput {
  title?: unknown;
  description?: string | null;
  capacity_hours_per_day?: unknown;
  target_end_date?: string | null;
  status?: unknown;
  position?: number;
}

export async function updateProject(
  db: Kysely<Database>,
  ctx: AuthContext,
  projectId: string,
  input: UpdateProjectInput,
): Promise<Project> {
  const patch: {
    title?: string;
    description?: string | null;
    capacity_hours_per_day?: number;
    target_end_date?: string | null;
    status?: ProjectStatus;
    completed_at?: Date | null;
    position?: number;
    updated_at: Date;
  } = { updated_at: new Date() };

  if (input.title !== undefined) patch.title = validateTitle(input.title);
  if (input.description !== undefined) patch.description = input.description;
  if (input.capacity_hours_per_day !== undefined) {
    patch.capacity_hours_per_day = validateCapacity(input.capacity_hours_per_day);
  }
  if (input.target_end_date !== undefined) {
    if (input.target_end_date != null && !isValidDateString(input.target_end_date)) {
      throw badRequest("target_end_date must be a valid YYYY-MM-DD date");
    }
    patch.target_end_date = input.target_end_date;
  }
  if (input.status !== undefined) {
    if (!PROJECT_STATUSES.includes(input.status as ProjectStatus)) {
      throw badRequest("status must be one of active | completed | archived");
    }
    patch.status = input.status as ProjectStatus;
    // status → 'completed' stamps completed_at server-side.
    if (patch.status === "completed") {
      const existing = await findProject(db, ctx, projectId);
      patch.completed_at = existing.completed_at ?? new Date();
    }
  }
  if (input.position !== undefined) {
    if (!Number.isInteger(input.position)) throw badRequest("position must be an integer");
    patch.position = input.position;
  }

  const updated = await db
    .updateTable("project")
    .set(patch)
    .where("id", "=", projectId)
    .where("workspace_id", "=", ctx.workspaceId)
    .returningAll()
    .executeTakeFirst();
  if (!updated) throw notFound("Project not found");
  return updated;
}

/** Delete a project subtree via the FK ON DELETE CASCADE chain (scoped to this
 *  project). The point ledger survives (sources ON DELETE SET NULL). */
export async function deleteProject(
  db: Kysely<Database>,
  ctx: AuthContext,
  projectId: string,
): Promise<void> {
  const result = await db
    .deleteFrom("project")
    .where("id", "=", projectId)
    .where("workspace_id", "=", ctx.workspaceId)
    .executeTakeFirst();
  if (Number(result.numDeletedRows) === 0) throw notFound("Project not found");
}
