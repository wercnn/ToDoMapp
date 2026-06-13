/**
 * POST /v1/tasks/{taskId}/pull-forward — work ahead (api §10, Decision #12). Pull a
 * task onto the target day (default local today), origin 'pulled_forward'. Validates
 * unblocked (422), not already on the target day (409). ⚡eng.
 */
import { handler, json, readJson } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { pullForward } from "@/domain/planItems";
import { isValidDateString } from "@/lib/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ taskId: string }> };

export const POST = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { taskId } = await context.params;
  const body = await readJson<{ to_date?: unknown }>(req);
  let toDate: string | null = null;
  if (body.to_date != null) {
    if (typeof body.to_date !== "string" || !isValidDateString(body.to_date)) {
      throw badRequest("to_date must be a YYYY-MM-DD date");
    }
    toDate = body.to_date;
  }
  const result = await pullForward(getDb(), ctx, taskId, toDate);
  return json(result);
});
