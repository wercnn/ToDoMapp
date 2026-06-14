/**
 * GET /v1/projects/{projectId}/progress — project-level roll-up (api §5).
 * Pure computation. 404 if the project isn't in the caller's workspace.
 */
import { handler, json } from "@/lib/http";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { computeProjectProgress } from "@/domain/progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { projectId } = await context.params;
  return json(await computeProjectProgress(getDb(), ctx, projectId));
});
