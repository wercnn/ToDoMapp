/**
 * POST /v1/replan-proposals/{proposalId}/approve  ⚡eng  (api §11)
 *
 * Accept the proposal, optionally edited. The diff is applied in one transaction:
 * moved items deferred, fresh items origin='replanned', time-fixed conflicts only
 * moved with an explicit choice (else 422), locked days untouched. Replanning
 * counts as engagement — the streak continues (Principle 3).
 */
import { handler, json, readJson } from "@/lib/http";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { approveProposal } from "@/domain/replan/proposals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ proposalId: string }> };

interface Body {
  edits?: unknown;
}

export const POST = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { proposalId } = await context.params;
  const body = await readJson<Body>(req);
  const result = await approveProposal(getDb(), ctx, proposalId, { edits: body.edits });
  return json(result);
});
