/**
 * GET    /v1/goals/{goalId}  — read one goal (Query: include=progress) (api §4)
 * PATCH  /v1/goals/{goalId}  — edit title/description/horizon/status/position
 * DELETE /v1/goals/{goalId}  — delete the goal and its whole subtree (FK cascade)
 */
import { handler, json, noContent, readJson } from "@/lib/http";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { getGoal, updateGoal, deleteGoal, type UpdateGoalInput } from "@/domain/goals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ goalId: string }> };

export const GET = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { goalId } = await context.params;
  const includeProgress = new URL(req.url).searchParams.get("include") === "progress";
  return json(await getGoal(getDb(), ctx, goalId, { includeProgress }));
});

export const PATCH = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { goalId } = await context.params;
  const body = await readJson<UpdateGoalInput>(req);
  return json(await updateGoal(getDb(), ctx, goalId, body));
});

export const DELETE = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { goalId } = await context.params;
  await deleteGoal(getDb(), ctx, goalId);
  return noContent();
});
