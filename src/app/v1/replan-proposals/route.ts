/**
 * GET  /v1/replan-proposals          — list proposals (default status=pending)
 * POST /v1/replan-proposals          — user-initiated replan (trigger='user_request')
 *
 * Replanning pipeline (api §11). Normal replans are manual (`user_request`);
 * slippage recovery is system-created for the morning brief but still user-applied.
 */
import { handler, json, readJson } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { isValidDateString } from "@/lib/dates";
import { createProposal, listProposals } from "@/domain/replan/proposals";
import type { ProposalStatus } from "@/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES: ProposalStatus[] = ["pending", "approved", "edited_approved", "rejected", "expired"];

export const GET = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  const statusParam = new URL(req.url).searchParams.get("status") ?? "pending";
  if (!STATUSES.includes(statusParam as ProposalStatus)) {
    throw badRequest(`status must be one of ${STATUSES.join(", ")}`);
  }
  const proposals = await listProposals(getDb(), ctx, { status: statusParam as ProposalStatus });
  return json(proposals);
});

interface Body {
  trigger?: string;
  scope?: { project_id?: string; from_date?: string };
  keep_today_task_ids?: unknown;
}

export const POST = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  const body = await readJson<Body>(req);

  // Only manual replans are client-initiated; slippage recovery comes from jobs.
  if (body.trigger !== "user_request") {
    throw badRequest("trigger must be 'user_request'");
  }
  if (body.scope?.from_date != null && !isValidDateString(body.scope.from_date)) {
    throw badRequest("scope.from_date must be a 'YYYY-MM-DD' date");
  }
  if (
    body.keep_today_task_ids !== undefined &&
    (!Array.isArray(body.keep_today_task_ids) ||
      !body.keep_today_task_ids.every((id) => typeof id === "string"))
  ) {
    throw badRequest("keep_today_task_ids must be an array of task ids");
  }

  const proposal = await createProposal(getDb(), ctx, {
    trigger: "user_request",
    scope: body.scope,
    keepTodayTaskIds: Array.isArray(body.keep_today_task_ids)
      ? (body.keep_today_task_ids as string[])
      : undefined,
  });
  return json(proposal, 201);
});
