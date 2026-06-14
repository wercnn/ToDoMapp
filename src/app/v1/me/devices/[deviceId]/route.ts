/** DELETE /v1/me/devices/{deviceId} — unregister a device (api §3). */
import { handler, noContent } from "@/lib/http";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { deleteDevice } from "@/domain/devices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ deviceId: string }> };

export const DELETE = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { deviceId } = await context.params;
  await deleteDevice(getDb(), ctx, deviceId);
  return noContent();
});
