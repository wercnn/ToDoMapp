/**
 * POST /v1/days/{date}/confirm — user approves a proposed day (api §10). The only
 * path from proposal to roadmap path (invariant #5). ⚡eng. 409 if not 'proposed'.
 */
import { handler, json } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { confirmDay } from "@/domain/roadmap";
import { isValidDateString } from "@/lib/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ date: string }> };

export const POST = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { date } = await context.params;
  if (!isValidDateString(date)) throw badRequest("date must be YYYY-MM-DD");
  const day = await confirmDay(getDb(), ctx, date);
  return json(day);
});
