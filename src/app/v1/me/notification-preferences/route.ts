/**
 * GET /v1/me/notification-preferences — read the 1:1 settings row (api §3).
 * PUT /v1/me/notification-preferences — full replace of all fields.
 */
import { handler, json, readJson } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { getPrefs, replacePrefs, type PrefsInput } from "@/domain/notificationPrefs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Accept 'HH:MM' or 'HH:MM:SS' (Postgres time), 24h.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export const GET = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  return json(await getPrefs(getDb(), ctx));
});

export const PUT = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  const body = await readJson<Record<string, unknown>>(req);

  const bools = [
    "morning_brief_enabled",
    "milestone_nudges_enabled",
    "replan_nudges_enabled",
    "streak_nudges_enabled",
  ] as const;
  for (const k of bools) {
    if (typeof body[k] !== "boolean") throw badRequest(`${k} (boolean) is required`);
  }
  if (typeof body.morning_brief_time !== "string" || !TIME_RE.test(body.morning_brief_time)) {
    throw badRequest("morning_brief_time must be 'HH:MM' or 'HH:MM:SS'");
  }

  const input: PrefsInput = {
    morning_brief_enabled: body.morning_brief_enabled as boolean,
    morning_brief_time: body.morning_brief_time,
    milestone_nudges_enabled: body.milestone_nudges_enabled as boolean,
    replan_nudges_enabled: body.replan_nudges_enabled as boolean,
    streak_nudges_enabled: body.streak_nudges_enabled as boolean,
  };
  return json(await replacePrefs(getDb(), ctx, input));
});
