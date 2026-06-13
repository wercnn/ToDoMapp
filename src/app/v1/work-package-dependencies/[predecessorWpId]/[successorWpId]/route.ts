/**
 * DELETE /v1/work-package-dependencies/{predecessorWpId}/{successorWpId} — remove
 * an edge (api §9). Downstream `blocked` state recomputes implicitly — never stored.
 */
import { handler, noContent } from "@/lib/http";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { deleteWorkPackageDependency } from "@/domain/dependencies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ predecessorWpId: string; successorWpId: string }> };

export const DELETE = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { predecessorWpId, successorWpId } = await context.params;
  await deleteWorkPackageDependency(getDb(), ctx, predecessorWpId, successorWpId);
  return noContent();
});
