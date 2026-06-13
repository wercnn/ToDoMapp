/**
 * POST /v1/tasks/{taskId}/reopen — un-complete a task (api §8). Clears status/cache,
 * returns today's plan item to 'planned'. Points are NEVER revoked (append-only
 * ledger, Principle 3). Thin route over the existing reopenTask cascade.
 */
import { handler, json } from "@/lib/http";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { reopenTask } from "@/domain/completion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ taskId: string }> };

export const POST = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { taskId } = await context.params;
  const task = await reopenTask(getDb(), ctx, taskId);
  return json(task);
});
