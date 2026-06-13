/**
 * POST /v1/replan-proposals/{proposalId}/reject  ⚡eng  (api §11)
 *
 * Decline the proposal; the plan stays exactly as it was. Engaging with the
 * decision still counts for the streak (Principle 3).
 */
import { handler, json } from "@/lib/http";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { rejectProposal } from "@/domain/replan/proposals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ proposalId: string }> };

export const POST = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { proposalId } = await context.params;
  const proposal = await rejectProposal(getDb(), ctx, proposalId);
  return json(proposal);
});
