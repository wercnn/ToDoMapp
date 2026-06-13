/**
 * POST /v1/roadmap/propose — (re)materialize proposed day-steps for the near
 * horizon (api §10). Planner fills each day to per-project capacity with unblocked
 * work; confirmed/locked days are never altered.
 */
import { handler, json, readJson } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { proposeRoadmap } from "@/domain/roadmap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  horizon_days?: number;
  goal_id?: string;
}

export const POST = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  const body = await readJson<Body>(req);

  if (body.horizon_days != null) {
    if (!Number.isInteger(body.horizon_days) || body.horizon_days < 1 || body.horizon_days > 60) {
      throw badRequest("horizon_days must be an integer in [1, 60]");
    }
  }

  const days = await proposeRoadmap(getDb(), ctx, {
    horizonDays: body.horizon_days,
    goalId: body.goal_id,
  });
  return json(days, 201);
});
