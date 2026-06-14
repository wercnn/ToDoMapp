/** GET /v1/me/stats — Companion home-screen read: points + streak (api §2). */
import { handler, json } from "@/lib/http";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { getStats } from "@/domain/me";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  return json(await getStats(getDb(), ctx));
});
