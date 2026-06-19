/**
 * POST /v1/replan-proposals/{proposalId}/days/{date}/approve
 *
 * Applies only the accepted final state for one review day. The proposal remains
 * pending until every review date is approved or rejected.
 */
import { handler, json, readJson } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { isValidDateString } from "@/lib/dates";
import { decideProposalDay } from "@/domain/replan/dayReview";
import type { TimeFixedResolution } from "@/domain/replan/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ proposalId: string; date: string }> };

interface Body {
  time_fixed_resolutions?: TimeFixedResolution[];
}

export const POST = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { proposalId, date } = await context.params;
  if (!isValidDateString(date)) throw badRequest("date must be YYYY-MM-DD");
  const body = await readJson<Body>(req);
  const result = await decideProposalDay(getDb(), ctx, proposalId, date, "approved", {
    timeFixedResolutions: body.time_fixed_resolutions ?? [],
  });
  return json(result);
});
