/**
 * Goals — top of the WBS (api-endpoints.md §4). Every query is scoped to the
 * caller's workspace; workspace_id is injected from the auth context, never the client.
 */
import type { Kysely } from "kysely";
import type { Database, Goal, GoalHorizon, GoalStatus } from "../db/types";
import type { AuthContext } from "../auth/context";
import { badRequest } from "../lib/errors";
import { validateTitle } from "./validation";

const HORIZONS: GoalHorizon[] = ["short", "mid", "long"];

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
