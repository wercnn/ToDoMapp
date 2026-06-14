/**
 * GET  /v1/me   — current user profile + workspace context (api §2).
 * PATCH /v1/me  — update display_name / timezone (forward-only boundary shift).
 */
import { handler, json, readJson } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { getMe, updateMe } from "@/domain/me";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** True if `tz` is an IANA zone the runtime accepts. */
function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const GET = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  return json(await getMe(getDb(), ctx));
});

export const PATCH = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  const body = await readJson<{ display_name?: unknown; timezone?: unknown }>(req);

  const input: { display_name?: string | null; timezone?: string } = {};
  if ("display_name" in body) {
    if (body.display_name !== null && typeof body.display_name !== "string") {
      throw badRequest("display_name must be a string or null");
    }
    input.display_name = body.display_name as string | null;
  }
  if ("timezone" in body) {
    if (typeof body.timezone !== "string" || !isValidTimezone(body.timezone)) {
      throw badRequest("timezone must be a valid IANA timezone");
    }
    input.timezone = body.timezone;
  }
  if (input.display_name === undefined && input.timezone === undefined) {
    throw badRequest("Provide display_name and/or timezone to update");
  }

  return json(await updateMe(getDb(), ctx, input));
});
