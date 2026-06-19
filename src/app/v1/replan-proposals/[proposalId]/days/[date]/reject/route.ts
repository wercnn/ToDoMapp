/**
 * POST /v1/replan-proposals/{proposalId}/days/{date}/reject
 *
 * Records a rejected review date without mutating roadmap tables. Rejected work is
 * reconsidered by the next manual replan.
 */
import { handler, json } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { isValidDateString } from "@/lib/dates";
import { decideProposalDay } from "@/domain/replan/dayReview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ proposalId: string; date: string }> };

export const POST = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { proposalId, date } = await context.params;
  if (!isValidDateString(date)) throw badRequest("date must be YYYY-MM-DD");
  return json(await decideProposalDay(getDb(), ctx, proposalId, date, "rejected"));
});
