/**
 * GET    /v1/work-packages/{wpId}  — read one WP (Query: include=tasks) (api §7)
 * PATCH  /v1/work-packages/{wpId}  — edit incl. milestone reassignment / time-fixed
 * DELETE /v1/work-packages/{wpId}  — delete the WP and its tasks (FK cascade)
 */
import { handler, json, noContent, readJson } from "@/lib/http";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import {
  getWorkPackage,
  updateWorkPackage,
  deleteWorkPackage,
  type UpdateWorkPackageInput,
} from "@/domain/workPackages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ wpId: string }> };

export const GET = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { wpId } = await context.params;
  const includeTasks = new URL(req.url).searchParams.get("include") === "tasks";
  return json(await getWorkPackage(getDb(), ctx, wpId, { includeTasks }));
});

export const PATCH = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { wpId } = await context.params;
  const body = await readJson<UpdateWorkPackageInput>(req);
  return json(await updateWorkPackage(getDb(), ctx, wpId, body));
});

export const DELETE = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { wpId } = await context.params;
  await deleteWorkPackage(getDb(), ctx, wpId);
  return noContent();
});
