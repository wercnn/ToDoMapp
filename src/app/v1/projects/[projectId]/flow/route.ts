/**
 * GET /v1/projects/{projectId}/flow — the Project Flow Diagram payload (api §5).
 * Fully derived: node statuses, dependency edges, critical path to the next
 * milestone. Nothing is written. 404 if the project isn't in the caller's workspace.
 */
import { handler, json } from "@/lib/http";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { getProjectFlow } from "@/domain/flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { projectId } = await context.params;
  const flow = await getProjectFlow(getDb(), ctx, projectId);
  return json(flow);
});
