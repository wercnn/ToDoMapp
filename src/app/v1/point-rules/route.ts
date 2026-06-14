/** GET /v1/point-rules — current point values per event type (read-only, api §12). */
import { handler, json } from "@/lib/http";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { listPointRules } from "@/domain/points";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  return json(await listPointRules(getDb(), ctx));
});
