/**
 * GET /v1/replan-proposals/{proposalId} — full proposal detail for the review UI
 * (api §11): the structured JSONB diff, with time-fixed conflicts in their own
 * section with explicit options (never auto-moves).
 */
import { handler, json } from "@/lib/http";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { getProposal } from "@/domain/replan/proposals";
import { emptyChanges, type Changes } from "@/domain/replan/types";
import { readTaskRefs } from "@/domain/roadmapRead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ proposalId: string }> };

export const GET = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { proposalId } = await context.params;
  const db = getDb();
  const proposal = await getProposal(db, ctx, proposalId);
  const changes: Changes = { ...emptyChanges(), ...(proposal.changes as Changes) };
  const taskIds = [
    ...changes.moves.map((move) => move.task_id),
    ...changes.time_fixed_conflicts.map((conflict) => conflict.task_id),
  ];
  const taskRefs = await readTaskRefs(db, ctx, taskIds);
  return json({ proposal, changes, refs: { tasks: Object.fromEntries(taskRefs) } });
});
