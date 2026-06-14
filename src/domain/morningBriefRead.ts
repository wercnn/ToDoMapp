/**
 * GET /morning-brief ⚡eng — the signature composite read behind the morning
 * notification (api-endpoints.md §10, Journey B/D). One call gives the Companion
 * everything for the wake-up moment: today's Daily Goals, the FULL stats row
 * (points AND streak — api §4.6 / Journey B surface both), any pending recovery
 * proposal headline, roadmap position, and the nearest milestone.
 *
 * It composes the read-only `readDay` core (NOT `getDay`) so engagement is recorded
 * exactly ONCE here, at the brief level — opening the brief is the qualifying
 * action. An empty morning (no persisted day today) returns `today: null` rather
 * than 404: the brief must never fail the wake-up read.
 */
import type { Kysely } from "kysely";
import type { Database } from "../db/types";
import type { AuthContext } from "../auth/context";
import { withTransaction } from "../db/transaction";
import { localDate } from "../lib/dates";
import { recordEngagement, refreshStats } from "./engagement";
import { readDay, type DayView } from "./roadmapRead";
import { getStats, type StatsView } from "./me";
import { projectMilestoneDates } from "./projection";
import { listProposals } from "./replan/proposals";

export interface MorningBrief {
  today: DayView | null;
  stats: StatsView;
  pending_proposal: { id: string; summary: string } | null;
  position: { today: string; current_streak: number };
  next_milestone: { id: string; title: string; projected_date: string; days_away: number } | null;
}

/** Whole-day difference `to - from` for two 'YYYY-MM-DD' strings (calendar days). */
function dayDiff(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export async function getMorningBrief(
  db: Kysely<Database>,
  ctx: AuthContext,
  now: Date = new Date(),
): Promise<MorningBrief> {
  const today = localDate(ctx.timezone, now);

  // ⚡eng once, at the brief level (opening the brief is the engagement).
  await withTransaction(db, async (trx) => {
    await recordEngagement(trx, {
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      localDate: today,
      now,
    });
    await refreshStats(trx, {
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      localToday: today,
      now,
    });
  });

  // Stats (read AFTER the refresh so the streak reflects today's engagement).
  const stats = await getStats(db, ctx);

  // Today's Daily Goals — null when there's no persisted day (empty morning).
  const todayView = await readDay(db, ctx, today);

  // Pending recovery proposal headline, if any (most recent pending).
  const pending = await listProposals(db, ctx, { status: "pending" });
  const pendingProposal = pending.length
    ? { id: pending[0]!.id, summary: pending[0]!.summary }
    : null;

  // Nearest milestone = unachieved, datable, with the EARLIEST projected_date.
  const milestoneDates = await projectMilestoneDates(db, ctx, { now });
  const unachieved = await db
    .selectFrom("milestone as m")
    .innerJoin("project as p", "p.id", "m.project_id")
    .select(["m.id as id", "m.title as title"])
    .where("m.workspace_id", "=", ctx.workspaceId)
    .where("m.achieved_at", "is", null)
    .where("p.status", "=", "active")
    .execute();

  let nextMilestone: MorningBrief["next_milestone"] = null;
  for (const m of unachieved) {
    const date = milestoneDates.get(m.id) ?? null;
    if (!date) continue;
    if (!nextMilestone || date < nextMilestone.projected_date) {
      nextMilestone = {
        id: m.id,
        title: m.title,
        projected_date: date,
        days_away: dayDiff(today, date),
      };
    }
  }

  return {
    today: todayView,
    stats,
    pending_proposal: pendingProposal,
    position: { today, current_streak: stats.current_streak },
    next_milestone: nextMilestone,
  };
}
