/**
 * POST /v1/days/{date}/items — user adds a task to a day (api §10), origin
 * 'user_added'. Validates unblocked (422), not already on day (409), not planned
 * elsewhere (409). ⚡eng.
 */
import { handler, json, readJson } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { addItem } from "@/domain/planItems";
import { isValidDateString } from "@/lib/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ date: string }> };

interface Body {
  task_id?: unknown;
  position?: unknown;
}

export const POST = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { date } = await context.params;
  if (!isValidDateString(date)) throw badRequest("date must be YYYY-MM-DD");

  const body = await readJson<Body>(req);
  if (typeof body.task_id !== "string") throw badRequest("task_id (string) is required");
  let position: number | null = null;
  if (body.position != null) {
    if (!Number.isInteger(body.position)) throw badRequest("position must be an integer");
    position = body.position as number;
  }

  const item = await addItem(getDb(), ctx, date, body.task_id, position);
  return json(item, 201);
});
