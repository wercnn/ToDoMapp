/**
 * GET  /v1/days/{date} — a day-step + its Daily Goals (api §10). ⚡eng when today.
 * PATCH /v1/days/{date} — lock/unlock the day.
 */
import { handler, json, readJson } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { getDay } from "@/domain/roadmapRead";
import { setDayLock } from "@/domain/planItems";
import { isValidDateString } from "@/lib/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ date: string }> };

export const GET = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { date } = await context.params;
  if (!isValidDateString(date)) throw badRequest("date must be YYYY-MM-DD");
  const view = await getDay(getDb(), ctx, date);
  return json(view);
});

export const PATCH = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { date } = await context.params;
  if (!isValidDateString(date)) throw badRequest("date must be YYYY-MM-DD");
  const body = await readJson<{ is_locked?: unknown }>(req);
  if (typeof body.is_locked !== "boolean") throw badRequest("is_locked (boolean) is required");
  const day = await setDayLock(getDb(), ctx, date, body.is_locked);
  return json(day);
});
