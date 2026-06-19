/**
 * Replan PROPOSALS service (api §11). The audit trail proving the roadmap is only
 * ever changed through explicit approval (invariant #5). Trigger-agnostic so the
 * Phase 5 slippage detector calls the exact same `createProposal` path.
 *
 * Concurrency / idempotency: approve and reject CLAIM the proposal with an
 * `UPDATE ... WHERE status='pending'` and assert exactly one row changed BEFORE any
 * plan mutation, all inside one `withTransaction`. A lost double-approve race finds
 * zero pending rows on its claim and rolls back having written nothing — the
 * row-count assertion, not the earlier read, is the real guard.
 */
import type { Kysely, Transaction } from "kysely";
import type { Database, ProposalStatus, ProposalTrigger, ReplanProposal } from "../../db/types";
import type { AuthContext, WorkspaceContext } from "../../auth/context";
import { withTransaction } from "../../db/transaction";
import { conflict, notFound } from "../../lib/errors";
import { localDate } from "../../lib/dates";
import { recordEngagement, refreshStats } from "../engagement";
import { analyzeReplan, type ReplanScope } from "./analyze";
import { applyChanges, type ApplyResult } from "./apply";
import { parseChanges, type Changes } from "./types";
import { proposalHasDayDecisions } from "./dayReview";

/** A newer pending proposal supersedes any older one (data-model §9.4). */
async function expireOlderPending(
  trx: Transaction<Database>,
  workspaceId: string,
  now: Date,
): Promise<void> {
  await trx
    .updateTable("replan_proposal")
    .set({ status: "expired", resolved_at: now })
    .where("workspace_id", "=", workspaceId)
    .where("status", "=", "pending")
    .execute();
}

/**
 * Supersede older pendings and insert a new pending proposal. Runs inside a caller's
 * transaction — used both standalone and atomically with WP-create (new_work_package).
 */
export async function createProposalInTx(
  trx: Transaction<Database>,
  ctx: WorkspaceContext,
  args: { trigger: ProposalTrigger; summary: string; changes: Changes; now: Date },
): Promise<ReplanProposal> {
  await expireOlderPending(trx, ctx.workspaceId, args.now);
  return trx
    .insertInto("replan_proposal")
    .values({
      workspace_id: ctx.workspaceId,
      trigger: args.trigger,
      status: "pending",
      summary: args.summary,
      changes: JSON.stringify(args.changes),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/**
 * Does this workspace have a pending proposal the USER initiated (`user_request`)
 * or that resulted from their own edit (`new_work_package`)? The automatic slippage
 * detector backs off when one exists rather than superseding it — overwriting a
 * proposal the user is about to approve would erase their intent (Phase 5 product
 * decision). A pending `slippage` proposal carries no such intent, so it may be
 * refreshed/superseded normally.
 */
export async function hasPendingUserIntentProposal(
  trx: Transaction<Database>,
  workspaceId: string,
): Promise<boolean> {
  const row = await trx
    .selectFrom("replan_proposal")
    .select("id")
    .where("workspace_id", "=", workspaceId)
    .where("status", "=", "pending")
    .where("trigger", "in", ["user_request", "new_work_package"])
    .executeTakeFirst();
  return row !== undefined;
}

/** Analyze current state and persist a pending proposal. Any trigger. */
export async function createProposal(
  db: Kysely<Database>,
  ctx: WorkspaceContext,
  opts: {
    trigger: ProposalTrigger;
    scope?: ReplanScope;
    horizonDays?: number;
    now?: Date;
    keepTodayTaskIds?: string[];
  },
): Promise<ReplanProposal> {
  const now = opts.now ?? new Date();
  const { summary, changes } = await analyzeReplan(db, ctx, {
    scope: opts.scope,
    horizonDays: opts.horizonDays,
    now,
    keepTodayTaskIds: opts.keepTodayTaskIds,
  });
  return withTransaction(db, (trx) =>
    createProposalInTx(trx, ctx, { trigger: opts.trigger, summary, changes, now }),
  );
}

export async function listProposals(
  db: Kysely<Database>,
  ctx: AuthContext,
  filter: { status?: ProposalStatus } = {},
): Promise<ReplanProposal[]> {
  let q = db
    .selectFrom("replan_proposal")
    .selectAll()
    .where("workspace_id", "=", ctx.workspaceId);
  if (filter.status) q = q.where("status", "=", filter.status);
  return q.orderBy("created_at", "desc").execute();
}

export async function getProposal(
  db: Kysely<Database>,
  ctx: AuthContext,
  proposalId: string,
): Promise<ReplanProposal> {
  const row = await db
    .selectFrom("replan_proposal")
    .selectAll()
    .where("id", "=", proposalId)
    .where("workspace_id", "=", ctx.workspaceId)
    .executeTakeFirst();
  if (!row) throw notFound("Proposal not found");
  return row;
}

export interface ApproveResult {
  proposal: ReplanProposal;
  applied: ApplyResult;
}

/**
 * Approve (optionally with edits). One transaction: claim → apply → engage. The
 * apply step throws 422 (time-fixed / locked) and rolls the whole thing back with
 * zero writes; a non-pending proposal (already resolved, expired/superseded) → 409.
 */
export async function approveProposal(
  db: Kysely<Database>,
  ctx: AuthContext,
  proposalId: string,
  opts: { edits?: unknown; now?: Date } = {},
): Promise<ApproveResult> {
  const now = opts.now ?? new Date();
  const today = localDate(ctx.timezone, now);
  const edited = opts.edits !== undefined && opts.edits !== null;
  const editChanges: Changes | null = edited ? parseChanges(opts.edits) : null;

  return withTransaction(db, async (trx) => {
    const existing = await trx
      .selectFrom("replan_proposal")
      .selectAll()
      .where("id", "=", proposalId)
      .where("workspace_id", "=", ctx.workspaceId)
      .executeTakeFirst();
    if (!existing) throw notFound("Proposal not found");
    if (existing.status !== "pending") {
      throw conflict(`Proposal is '${existing.status}', not 'pending' — cannot approve`);
    }
    if (proposalHasDayDecisions(existing.changes as Changes)) {
      throw conflict("Proposal has day-level decisions; continue review day by day.");
    }

    const effective: Changes = editChanges ?? (existing.changes as Changes);
    const newStatus: ProposalStatus = edited ? "edited_approved" : "approved";

    // CLAIM first: the row-count assertion is the authoritative race guard.
    let claimed = await trx
      .updateTable("replan_proposal")
      .set({
        status: newStatus,
        applied_changes: null,
        resolved_by_user_id: ctx.userId,
        resolved_at: now,
      })
      .where("id", "=", proposalId)
      .where("status", "=", "pending")
      .returningAll()
      .executeTakeFirst();
    if (!claimed) throw conflict("Proposal was concurrently resolved");

    // Now safe to mutate the plan (guards inside may throw 422 → full rollback).
    const applied = await applyChanges(trx, ctx, effective, now);
    const appliedChanges: Changes = {
      ...effective,
      ...(Object.keys(applied.split_task_id_map).length > 0
        ? { split_task_id_map: applied.split_task_id_map }
        : {}),
    };
    claimed = await trx
      .updateTable("replan_proposal")
      .set({ applied_changes: JSON.stringify(appliedChanges) })
      .where("id", "=", proposalId)
      .returningAll()
      .executeTakeFirstOrThrow();

    // ⚡eng: engaging with the decision keeps the streak alive (Principle 3). No penalty events.
    await recordEngagement(trx, { userId: ctx.userId, workspaceId: ctx.workspaceId, localDate: today, now });
    await refreshStats(trx, { userId: ctx.userId, workspaceId: ctx.workspaceId, localToday: today, now });

    return { proposal: claimed, applied };
  });
}

/** Reject: claim → engage. The plan is never touched. */
export async function rejectProposal(
  db: Kysely<Database>,
  ctx: AuthContext,
  proposalId: string,
  opts: { now?: Date } = {},
): Promise<ReplanProposal> {
  const now = opts.now ?? new Date();
  const today = localDate(ctx.timezone, now);

  return withTransaction(db, async (trx) => {
    const existing = await trx
      .selectFrom("replan_proposal")
      .selectAll()
      .where("id", "=", proposalId)
      .where("workspace_id", "=", ctx.workspaceId)
      .executeTakeFirst();
    if (!existing) throw notFound("Proposal not found");
    if (existing.status !== "pending") {
      throw conflict(`Proposal is '${existing.status}', not 'pending' — cannot reject`);
    }
    if (proposalHasDayDecisions(existing.changes as Changes)) {
      throw conflict("Proposal has day-level decisions; continue review day by day.");
    }

    const claimed = await trx
      .updateTable("replan_proposal")
      .set({ status: "rejected", resolved_by_user_id: ctx.userId, resolved_at: now })
      .where("id", "=", proposalId)
      .where("status", "=", "pending")
      .returningAll()
      .executeTakeFirst();
    if (!claimed) throw conflict("Proposal was concurrently resolved");

    await recordEngagement(trx, { userId: ctx.userId, workspaceId: ctx.workspaceId, localDate: today, now });
    await refreshStats(trx, { userId: ctx.userId, workspaceId: ctx.workspaceId, localToday: today, now });

    return claimed;
  });
}
