/**
 * GET    /v1/tasks/{taskId}  — read one task + derived `blocked` (api §8)
 * PATCH  /v1/tasks/{taskId}  — edit title/notes/estimates/time-fixed/position
 *   (status/completed_at go through complete/reopen, never here)
 * DELETE /v1/tasks/{taskId}  — delete the task (dep edges + plan items cascade)
 */
import { handler, json, noContent, readJson } from "@/lib/http";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { getTask, updateTask, deleteTask, type UpdateTaskInput } from "@/domain/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ taskId: string }> };

export const GET = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { taskId } = await context.params;
  return json(await getTask(getDb(), ctx, taskId));
});

export const PATCH = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { taskId } = await context.params;
  const body = await readJson<UpdateTaskInput & { status?: unknown; completed_at?: unknown }>(req);
  return json(await updateTask(getDb(), ctx, taskId, body));
});

export const DELETE = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { taskId } = await context.params;
  await deleteTask(getDb(), ctx, taskId);
  return noContent();
});
