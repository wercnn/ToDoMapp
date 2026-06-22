/**
 * Slippage detector (api §13, foundation §4.4, Journey D). Per-user, runs as the
 * user's local day turns over. Its WHOLE job is detect → call the existing
 * trigger-agnostic proposal machinery. It does NOT reimplement analyze/diff/apply.
 *
 * What it is allowed to write (and nothing else):
 *   - `daily_plan_day.status` → 'slipped' for a past confirmed day with incomplete
 *     work (a day-level status flag that FEEDS the replanning pipeline);
 *   - one pending `replan_proposal` (trigger 'slippage') via `createProposalInTx`.
 *
 * Invariant #5 (the landmine): a background job NEVER mutates `daily_plan_item` and
 * NEVER applies a diff. The plan changes only on user approval of the proposal. This
 * module imports `createProposalInTx`/`analyzeReplan` and pointedly NOT `applyChanges`.
 *
 * Idempotency / catch-up: detection is a STATE SCAN, not a boundary-crossing event —
 * it finds confirmed days strictly before the user's current local date that still
 * hold a 'planned' item. Marking flips them to 'slipped', so they no longer match;
 * a late, double, or missed-then-retried run finds nothing new. Marking + proposal
 * commit in ONE transaction, so we can't leave a slipped day with no proposal.
 */
import type { Kysely } from "kysely";
import type { Database } from "../../db/types";
import type { WorkspaceContext } from "../../auth/context";
import { withTransaction } from "../../db/transaction";
import { localDate } from "../../lib/dates";
import { analyzeReplan } from "../replan/analyze";
import { createProposalInTx } from "../replan/proposals";

export interface SlippageResult {
  slippedDayIds: string[];
  proposalCreated: boolean;
}

/** Confirmed days before `localToday` that still have at least one planned item. */
async function findSlippableDayIds(
  db: Kysely<Database>,
  ctx: WorkspaceContext,
  localToday: string,
): Promise<string[]> {
  const rows = await db
    .selectFrom("daily_plan_day as d")
    .select("d.id")
    .where("d.workspace_id", "=", ctx.workspaceId)
    .where("d.status", "=", "confirmed")
    .where("d.plan_date", "<", localToday)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom("daily_plan_item as i")
          .select("i.id")
          .whereRef("i.daily_plan_day_id", "=", "d.id")
          .where("i.status", "=", "planned"),
      ),
    )
    .orderBy("d.plan_date")
    .execute();
  return rows.map((r) => r.id);
}

/**
 * Detect slipped days for one user and, if there is something to replan, surface a
 * pending recovery proposal. Returns what it did (for the tick summary / tests).
 */
export async function detectSlippageForUser(
  db: Kysely<Database>,
  ctx: WorkspaceContext,
  now: Date = new Date(),
): Promise<SlippageResult> {
  const localToday = localDate(ctx.timezone, now);
  const slippedDayIds = await findSlippableDayIds(db, ctx, localToday);
  if (slippedDayIds.length === 0) {
    return { slippedDayIds: [], proposalCreated: false };
  }

  // Analyze BEFORE the write transaction: it's a heavy read and the 'slipped' flag
  // doesn't touch items, so the prospective diff is identical either way.
  const { summary, changes } = await analyzeReplan(db, ctx, {
    now,
    recovery: { slippedDayIds },
  });
  const actionable =
    changes.moves.length > 0 ||
    changes.time_fixed_conflicts.length > 0 ||
    (changes.planning_conflicts?.length ?? 0) > 0 ||
    (changes.split_report?.length ?? 0) > 0;

  return withTransaction(db, async (trx) => {
    await trx
      .updateTable("daily_plan_day")
      .set({ status: "slipped" })
      .where("workspace_id", "=", ctx.workspaceId)
      .where("id", "in", slippedDayIds)
      .execute();

    // Nothing to replan → mark the day slipped but don't manufacture a no-op proposal.
    if (!actionable) return { slippedDayIds, proposalCreated: false };

    await createProposalInTx(trx, ctx, { trigger: "slippage", summary, changes, now });
    return { slippedDayIds, proposalCreated: true };
  });
}
