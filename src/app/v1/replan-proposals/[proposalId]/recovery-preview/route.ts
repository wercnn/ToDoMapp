/**
 * POST /v1/replan-proposals/{proposalId}/recovery-preview
 *
 * Recomputes a slippage recovery proposal with the user's morning choices, but
 * writes nothing. Used by the morning brief sheet before applying recovery.
 */
import { handler, json, readJson } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { previewRecoveryProposal } from "@/domain/replan/proposals";
import type { TimeFixedResolution } from "@/domain/replan/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ proposalId: string }> };

interface Body {
  today_task_ids?: unknown;
  time_fixed_resolutions?: TimeFixedResolution[];
}

function todayTaskIds(body: Body): string[] {
  if (!Array.isArray(body.today_task_ids) || !body.today_task_ids.every((id) => typeof id === "string")) {
    throw badRequest("today_task_ids must be an array of task ids");
  }
  return body.today_task_ids as string[];
}

export const POST = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { proposalId } = await context.params;
  const body = await readJson<Body>(req);
  return json(
    await previewRecoveryProposal(getDb(), ctx, proposalId, {
      todayTaskIds: todayTaskIds(body),
      timeFixedResolutions: body.time_fixed_resolutions ?? [],
    }),
  );
});
