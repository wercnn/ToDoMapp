/**
 * GET /v1/goals/{goalId}/progress — progress roll-up over descendant tasks (api §4).
 * Pure computation, never stored. 404 if the goal isn't in the caller's workspace.
 */
import { handler, json } from "@/lib/http";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { computeGoalProgress } from "@/domain/progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ goalId: string }> };

export const GET = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { goalId } = await context.params;
  return json(await computeGoalProgress(getDb(), ctx, goalId));
});
