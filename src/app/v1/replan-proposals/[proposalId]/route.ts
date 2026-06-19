/**
 * GET /v1/replan-proposals/{proposalId} — full proposal detail for the review UI
 * (api §11): the structured JSONB diff, with time-fixed conflicts in their own
 * section with explicit options (never auto-moves).
 */
import { handler, json } from "@/lib/http";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { getProposalDetailView } from "@/domain/replan/dayReview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ proposalId: string }> };

export const GET = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { proposalId } = await context.params;
  return json(await getProposalDetailView(getDb(), ctx, proposalId));
});
