/**
 * Goals — top of the WBS (api-endpoints.md §4). Every query is scoped to the
 * caller's workspace; workspace_id is injected from the auth context, never the client.
 */
import type { Kysely } from "kysely";
import type { Database, Goal, GoalHorizon, GoalStatus } from "../db/types";
import type { AuthContext } from "../auth/context";
import { badRequest, notFound } from "../lib/errors";
import { validateTitle } from "./validation";
import { computeGoalProgress, type Progress } from "./progress";

const HORIZONS: GoalHorizon[] = ["short", "mid", "long"];
const GOAL_STATUSES: GoalStatus[] = ["active", "achieved", "archived"];

export interface CreateGoalInput {
  id?: string;
  title: unknown;
  description?: string | null;
  horizon: unknown;
  position?: number;
}

export async function createGoal(
  db: Kysely<Database>,
  ctx: AuthContext,
  input: CreateGoalInput,
): Promise<Goal> {
  const title = validateTitle(input.title);
  if (!HORIZONS.includes(input.horizon as GoalHorizon)) {
    throw badRequest("horizon must be one of short | mid | long");
  }
  return db
    .insertInto("goal")
    .values({
      ...(input.id ? { id: input.id } : {}),
      workspace_id: ctx.workspaceId,
      title,
      description: input.description ?? null,
      horizon: input.horizon as GoalHorizon,
      ...(input.position != null ? { position: input.position } : {}),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function listGoals(
  db: Kysely<Database>,
  ctx: AuthContext,
  filters: { status?: GoalStatus; horizon?: GoalHorizon } = {},
): Promise<Goal[]> {
  let q = db
    .selectFrom("goal")
    .selectAll()
    .where("workspace_id", "=", ctx.workspaceId);
  if (filters.status) q = q.where("status", "=", filters.status);
  if (filters.horizon) q = q.where("horizon", "=", filters.horizon);
  return q.orderBy("position").orderBy("created_at").execute();
}

async function findGoal(db: Kysely<Database>, ctx: AuthContext, goalId: string): Promise<Goal> {
  const goal = await db
    .selectFrom("goal")
    .selectAll()
    .where("id", "=", goalId)
    .where("workspace_id", "=", ctx.workspaceId)
    .executeTakeFirst();
  if (!goal) throw notFound("Goal not found");
  return goal;
}

export interface GoalWithProgress extends Goal {
  progress: Progress;
}

export async function getGoal(
  db: Kysely<Database>,
  ctx: AuthContext,
  goalId: string,
  opts: { includeProgress?: boolean } = {},
): Promise<Goal | GoalWithProgress> {
  const goal = await findGoal(db, ctx, goalId);
  if (!opts.includeProgress) return goal;
  return { ...goal, progress: await computeGoalProgress(db, ctx, goalId) };
}

export interface UpdateGoalInput {
  title?: unknown;
  description?: string | null;
  horizon?: unknown;
  status?: unknown;
  position?: number;
}

export async function updateGoal(
  db: Kysely<Database>,
  ctx: AuthContext,
  goalId: string,
  input: UpdateGoalInput,
): Promise<Goal> {
  const patch: {
    title?: string;
    description?: string | null;
    horizon?: GoalHorizon;
    status?: GoalStatus;
    achieved_at?: Date | null;
    position?: number;
    updated_at: Date;
  } = { updated_at: new Date() };

  if (input.title !== undefined) patch.title = validateTitle(input.title);
  if (input.description !== undefined) patch.description = input.description;
  if (input.horizon !== undefined) {
    if (!HORIZONS.includes(input.horizon as GoalHorizon)) {
      throw badRequest("horizon must be one of short | mid | long");
    }
    patch.horizon = input.horizon as GoalHorizon;
  }
  if (input.status !== undefined) {
    if (!GOAL_STATUSES.includes(input.status as GoalStatus)) {
      throw badRequest("status must be one of active | achieved | archived");
    }
    patch.status = input.status as GoalStatus;
    // status → 'achieved' stamps achieved_at server-side (clients never write it).
    if (patch.status === "achieved") {
      const existing = await findGoal(db, ctx, goalId);
      patch.achieved_at = existing.achieved_at ?? new Date();
    }
  }
  if (input.position !== undefined) {
    if (!Number.isInteger(input.position)) throw badRequest("position must be an integer");
    patch.position = input.position;
  }

  const updated = await db
    .updateTable("goal")
    .set(patch)
    .where("id", "=", goalId)
    .where("workspace_id", "=", ctx.workspaceId)
    .returningAll()
    .executeTakeFirst();
  if (!updated) throw notFound("Goal not found");
  return updated;
}

/** Delete a goal and its whole subtree via the FK ON DELETE CASCADE chain
 *  (project → milestone/work_package → task → deps/plan items). The point ledger
 *  survives — its sources are ON DELETE SET NULL. No manual cascade in the app. */
export async function deleteGoal(
  db: Kysely<Database>,
  ctx: AuthContext,
  goalId: string,
): Promise<void> {
  const result = await db
    .deleteFrom("goal")
    .where("id", "=", goalId)
    .where("workspace_id", "=", ctx.workspaceId)
    .executeTakeFirst();
  if (Number(result.numDeletedRows) === 0) throw notFound("Goal not found");
}
