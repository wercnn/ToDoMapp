/**
 * POST /v1/tasks/{taskId}/complete — check off a task (api §8). Runs the full
 * completion cascade in one transaction: task done → plan item → points (once) →
 * work-package cache → milestone achievement → daily-goal completion → stats. ⚡eng.
 */
import { handler, json } from "@/lib/http";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { completeTask } from "@/domain/completion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ taskId: string }> };

export const POST = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { taskId } = await context.params;
  const result = await completeTask(getDb(), ctx, taskId);
  return json(result);
});
