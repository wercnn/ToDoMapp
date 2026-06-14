/**
 * POST /v1/me/engagement ⚡eng — explicitly record "I engaged with my plan today".
 * Idempotent upsert of today's local engagement_day; same-day repeats are no-ops.
 */
import { handler, json } from "@/lib/http";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { recordEngagementAction } from "@/domain/me";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  return json(await recordEngagementAction(getDb(), ctx));
});
