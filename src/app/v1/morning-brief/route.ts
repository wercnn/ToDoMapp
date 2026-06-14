/**
 * GET /v1/morning-brief ⚡eng — the signature composite read (api §10). Today's
 * Daily Goals, full stats (points AND streak), pending proposal headline, roadmap
 * position, and the nearest milestone. Opening it records engagement once.
 */
import { handler, json } from "@/lib/http";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { getMorningBrief } from "@/domain/morningBriefRead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  return json(await getMorningBrief(getDb(), ctx));
});
