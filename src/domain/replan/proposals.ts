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
import { badRequest, conflict, notFound, unprocessable } from "../../lib/errors";
import { localDate } from "../../lib/dates";
import { recordEngagement, refreshStats } from "../engagement";
import { analyzeReplan, type ReplanScope } from "./analyze";
import { applyChanges, type ApplyResult } from "./apply";
import {
  emptyChanges,
  parseChanges,
  type Changes,
  type ReplanRecoveryMeta,
  type TimeFixedResolution,
} from "./types";
import {
  buildProposalPreview,
  getProposalDetailView,
  proposalHasDayDecisions,
  type ReplanProposalDetailView,
} from "./dayReview";

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

function normalizeChanges(input: unknown): Changes {
  return { ...emptyChanges(), ...((input ?? {}) as Changes) };
}

function assertRecovery(changes: Changes): ReplanRecoveryMeta {
  if (!changes.recovery) throw badRequest("Proposal does not contain a recovery flow.");
  return changes.recovery;
}

function applyTimeFixedRecoveryChoices(
  changes: Changes,
  resolutions: TimeFixedResolution[],
  today: string,
): Changes {
  const resolutionByTask = new Map(resolutions.map((r) => [r.task_id, r]));
  const normalizedResolutions: TimeFixedResolution[] = [];
  const resolvedTaskIds = new Set(resolutions.map((r) => r.task_id));
  const moves = [...(changes.moves ?? [])].filter((move) => !resolvedTaskIds.has(move.task_id));

  for (const conflict of changes.time_fixed_conflicts ?? []) {
    const res = resolutionByTask.get(conflict.task_id);
    if (!res) continue;
    if (res.choice === "descope") {
      moves.push({ task_id: conflict.task_id, from_date: conflict.fixed_date, to_date: null });
      normalizedResolutions.push(res);
      continue;
    }
    const newDate = res.choice === "prioritize" ? today : res.new_fixed_date;
    if (!newDate) throw unprocessable(`renegotiate of task ${conflict.task_id} requires new_fixed_date.`);
    moves.push({ task_id: conflict.task_id, from_date: conflict.fixed_date, to_date: newDate });
    normalizedResolutions.push({
      task_id: conflict.task_id,
      choice: "renegotiate",
      new_fixed_date: newDate,
    });
  }

  return {
    ...changes,
    moves,
    time_fixed_resolutions: normalizedResolutions,
  };
}

function unresolvedTimeFixedRecoveryConflicts(
  changes: Changes,
  resolutions: TimeFixedResolution[],
): string[] {
  const resolved = new Set(resolutions.map((r) => r.task_id));
  return (changes.time_fixed_conflicts ?? [])
    .map((conflict) => conflict.task_id)
    .filter((taskId) => !resolved.has(taskId));
}

function recoveryBlockingConflicts(changes: Changes): Changes["planning_conflicts"] {
  const selected = new Set(changes.recovery?.selected_today_task_ids ?? []);
  return (changes.planning_conflicts ?? []).filter((conflict) => {
    const type = String((conflict as Record<string, unknown>).type ?? "");
    const taskId = String((conflict as Record<string, unknown>).task_id ?? "");
    return type.includes("dependency") && (!taskId || selected.has(taskId));
  });
}

async function analyzeRecoveryForProposal(
  db: Kysely<Database> | Transaction<Database>,
  ctx: WorkspaceContext,
  existing: ReplanProposal,
  todayTaskIds: string[],
  timeFixedResolutions: TimeFixedResolution[],
  now: Date,
): Promise<{ summary: string; changes: Changes }> {
  const base = normalizeChanges(existing.changes);
  const recovery = assertRecovery(base);
  const analyzed = await analyzeReplan(db, ctx, {
    now,
    recovery: {
      slippedDates: recovery.slipped_dates,
      todayTaskIds,
    },
  });
  analyzed.changes = applyTimeFixedRecoveryChoices(
    analyzed.changes,
    timeFixedResolutions,
    localDate(ctx.timezone, now),
  );
  return analyzed;
}

export async function previewRecoveryProposal(
  db: Kysely<Database>,
  ctx: AuthContext,
  proposalId: string,
  opts: { todayTaskIds: string[]; timeFixedResolutions?: TimeFixedResolution[]; now?: Date },
): Promise<ReplanProposalDetailView> {
  const now = opts.now ?? new Date();
  const existing = await getProposal(db, ctx, proposalId);
  if (existing.status !== "pending") {
    throw conflict(`Proposal is '${existing.status}', not 'pending' — cannot preview recovery`);
  }
  const { summary, changes } = await analyzeRecoveryForProposal(
    db,
    ctx,
    existing,
    opts.todayTaskIds,
    opts.timeFixedResolutions ?? [],
    now,
  );
  const preview = await buildProposalPreview(db, ctx, changes);
  return {
    proposal: { ...existing, summary, changes: JSON.stringify(changes) } as ReplanProposal,
    changes,
    refs: { tasks: preview.refs },
    preview,
  };
}

export interface ApproveResult {
  proposal: ReplanProposal;
  applied: ApplyResult;
}

export async function applyRecoveryProposal(
  db: Kysely<Database>,
  ctx: AuthContext,
  proposalId: string,
  opts: { todayTaskIds: string[]; timeFixedResolutions?: TimeFixedResolution[]; now?: Date },
): Promise<ReplanProposalDetailView> {
  const now = opts.now ?? new Date();
  const today = localDate(ctx.timezone, now);

  await withTransaction(db, async (trx) => {
    const existing = await trx
      .selectFrom("replan_proposal")
      .selectAll()
      .where("id", "=", proposalId)
      .where("workspace_id", "=", ctx.workspaceId)
      .forUpdate()
      .executeTakeFirst();
    if (!existing) throw notFound("Proposal not found");
    if (existing.status !== "pending") {
      throw conflict(`Proposal is '${existing.status}', not 'pending' — cannot apply recovery`);
    }

    const { summary, changes } = await analyzeRecoveryForProposal(
      trx,
      ctx,
      existing,
      opts.todayTaskIds,
      opts.timeFixedResolutions ?? [],
      now,
    );
    const unresolved = unresolvedTimeFixedRecoveryConflicts(changes, opts.timeFixedResolutions ?? []);
    if (unresolved.length > 0) {
      throw unprocessable(`Resolve time-fixed task(s) before applying recovery: ${unresolved.join(", ")}`);
    }
    const blocking = recoveryBlockingConflicts(changes);
    if (blocking && blocking.length > 0) {
      throw unprocessable("Today selection violates dependency order. Push blocked tasks to the future first.");
    }

    const applied = await applyChanges(trx, ctx, changes, now);
    const appliedChanges: Changes = {
      ...changes,
      ...(Object.keys(applied.split_task_id_map).length > 0
        ? { split_task_id_map: applied.split_task_id_map }
        : {}),
    };

    await trx
      .updateTable("replan_proposal")
      .set({
        status: "edited_approved",
        summary,
        changes: JSON.stringify(changes),
        applied_changes: JSON.stringify(appliedChanges),
        resolved_by_user_id: ctx.userId,
        resolved_at: now,
      })
      .where("id", "=", proposalId)
      .execute();

    await recordEngagement(trx, { userId: ctx.userId, workspaceId: ctx.workspaceId, localDate: today, now });
    await refreshStats(trx, { userId: ctx.userId, workspaceId: ctx.workspaceId, localToday: today, now });
  });

  return getProposalDetailView(db, ctx, proposalId);
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
