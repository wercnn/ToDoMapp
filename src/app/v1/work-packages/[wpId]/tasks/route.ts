/**
 * GET  /v1/work-packages/{wpId}/tasks  — list to-do lines (filter: status), each
 *                                         with derived `blocked`
 * POST /v1/work-packages/{wpId}/tasks  — create a task
 */
import { handler, json, readJson } from "@/lib/http";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { createTask, listTasks, type CreateTaskInput } from "@/domain/tasks";
import type { TaskStatus } from "@/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ wpId: string }> };

export const GET = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { wpId } = await context.params;
  const params = new URL(req.url).searchParams;
  const tasks = await listTasks(getDb(), ctx, wpId, {
    status: (params.get("status") as TaskStatus) ?? undefined,
  });
  return json(tasks);
});

export const POST = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { wpId } = await context.params;
  const body = await readJson<CreateTaskInput>(req);
  const now = new Date();
  const task = await createTask(getDb(), ctx, wpId, body, now, { autoPlace: true });
  return json(task, 201);
});
