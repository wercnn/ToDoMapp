/**
 * PATCH  /v1/plan-items/{itemId} — reorder or mark deferred (api §10).
 * DELETE /v1/plan-items/{itemId} — remove from the day (defer without target). ⚡eng.
 */
import { handler, json, noContent, readJson } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { patchItem, deleteItem } from "@/domain/planItems";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ itemId: string }> };

interface Body {
  position?: unknown;
  status?: unknown;
}

export const PATCH = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { itemId } = await context.params;
  const body = await readJson<Body>(req);

  let position: number | undefined;
  if (body.position != null) {
    if (!Number.isInteger(body.position)) throw badRequest("position must be an integer");
    position = body.position as number;
  }
  let status: string | undefined;
  if (body.status != null) {
    if (typeof body.status !== "string") throw badRequest("status must be a string");
    status = body.status;
  }

  const item = await patchItem(getDb(), ctx, itemId, { position, status });
  return json(item);
});

export const DELETE = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { itemId } = await context.params;
  await deleteItem(getDb(), ctx, itemId);
  return noContent();
});
