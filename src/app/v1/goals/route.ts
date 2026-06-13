/**
 * GET  /v1/goals  — list goals (filters: status, horizon)
 * POST /v1/goals  — create a goal
 */
import { handler, json, readJson } from "@/lib/http";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { createGoal, listGoals, type CreateGoalInput } from "@/domain/goals";
import type { GoalHorizon, GoalStatus } from "@/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  const params = new URL(req.url).searchParams;
  const goals = await listGoals(getDb(), ctx, {
    status: (params.get("status") as GoalStatus) ?? undefined,
    horizon: (params.get("horizon") as GoalHorizon) ?? undefined,
  });
  return json(goals);
});

export const POST = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  const body = await readJson<CreateGoalInput>(req);
  const goal = await createGoal(getDb(), ctx, body);
  return json(goal, 201);
});
