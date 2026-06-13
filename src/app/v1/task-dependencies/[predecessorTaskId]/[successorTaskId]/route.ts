/**
 * DELETE /v1/task-dependencies/{predecessorTaskId}/{successorTaskId} — remove an
 * edge (api §9). Downstream `blocked` state recomputes implicitly — never stored.
 */
import { handler, noContent } from "@/lib/http";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { deleteTaskDependency } from "@/domain/dependencies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ predecessorTaskId: string; successorTaskId: string }> };

export const DELETE = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { predecessorTaskId, successorTaskId } = await context.params;
  await deleteTaskDependency(getDb(), ctx, predecessorTaskId, successorTaskId);
  return noContent();
});
