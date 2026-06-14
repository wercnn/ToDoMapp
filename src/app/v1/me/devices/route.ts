/**
 * GET  /v1/me/devices — list the caller's registered push devices (api §3).
 * POST /v1/me/devices — register/refresh an APNs token (upsert by push_token).
 */
import { handler, json, readJson } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { listDevices, registerDevice } from "@/domain/devices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  return json(await listDevices(getDb(), ctx));
});

export const POST = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  const body = await readJson<{ platform?: unknown; push_token?: unknown }>(req);
  if (body.platform !== "ios") throw badRequest("platform must be 'ios'");
  if (typeof body.push_token !== "string" || body.push_token.length === 0) {
    throw badRequest("push_token (non-empty string) is required");
  }
  const device = await registerDevice(getDb(), ctx, {
    platform: "ios",
    push_token: body.push_token,
  });
  return json(device, 201);
});
