/**
 * GET /v1/roadmap — the Duolingo-style path (api §10): persisted past/confirmed
 * days ∪ the live projection beyond, milestones as landmarks dated by
 * achieved_date ?? projected_date, and "you are here". Pure read — writes nothing.
 */
import { handler, json } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { getRoadmap } from "@/domain/roadmapRead";
import { isValidDateString } from "@/lib/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  const goalId = url.searchParams.get("goal_id") ?? undefined;
  if (from && !isValidDateString(from)) throw badRequest("from must be YYYY-MM-DD");
  if (to && !isValidDateString(to)) throw badRequest("to must be YYYY-MM-DD");

  const roadmap = await getRoadmap(getDb(), ctx, { from, to, goalId });
  return json(roadmap);
});
