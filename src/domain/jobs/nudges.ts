/**
 * Contextual nudges (api §13): gentle, engagement-framed, and EACH gated by its own
 * preference flag (§4.6 — notifications inform and invite, they don't nag). A flag
 * that's off means the nudge is never even selected.
 *
 * Dedupe granularity carries the TRIGGERING ENTITY so we don't over- or under-fire:
 *   - replan_needs_review  → the pending proposal's id (once per proposal)
 *   - streak_at_risk       → local date              (at most once per local day)
 *   - milestone_approaching→ the milestone's id       (once per milestone)
 *
 * Wired vs stubbed in Phase 5:
 *   - replan_needs_review  — FULLY WIRED (reads `replan_proposal`).
 *   - streak_at_risk       — FULLY WIRED (reads `user_stats` + `engagement_day`).
 *   - milestone_approaching— STUBBED: "approaching" is a date predicate and the
 *     milestone `projected_date` projection is Phase 6 (see flow.ts). The gate and
 *     dedupe-key wiring exist; the predicate returns nothing until projection lands.
 */
import type { Kysely } from "kysely";
import type { Database, NotificationPreference } from "../../db/types";
import type { WorkspaceContext } from "../../auth/context";
import { localDate, localTime } from "../../lib/dates";
import { claimDispatch, deliverToUser } from "./dispatch";
import type { Notifier } from "./notifier";

/** Local hour (24h) at/after which an unengaged day is "at risk" for the streak. */
export const STREAK_RISK_HOUR = 20;

/**
 * "Plan needs review": there's a pending recovery proposal awaiting the user. Fires
 * once per proposal (keyed on its id), gated by `replan_nudges_enabled`.
 */
export async function nudgeReplanNeedsReview(
  db: Kysely<Database>,
  ctx: WorkspaceContext,
  pref: NotificationPreference,
  notifier: Notifier,
): Promise<boolean> {
  if (!pref.replan_nudges_enabled) return false;

  const pending = await db
    .selectFrom("replan_proposal")
    .select(["id", "summary"])
    .where("workspace_id", "=", ctx.workspaceId)
    .where("status", "=", "pending")
    .executeTakeFirst();
  if (!pending) return false;

  const claimed = await claimDispatch(db, {
    userId: ctx.userId,
    kind: "replan_needs_review",
    dedupeKey: pending.id,
  });
  if (!claimed) return false;

  await deliverToUser(db, notifier, ctx.userId, {
    kind: "replan_needs_review",
    title: "Your plan needs a quick review",
    body: pending.summary,
    deepLink: `/replan-proposals/${pending.id}`,
  });
  return true;
}

/**
 * "Streak at risk": the user has a live streak but hasn't engaged today, and their
 * local day is getting late. Fires at most once per local day, gated by
 * `streak_nudges_enabled`.
 */
export async function nudgeStreakAtRisk(
  db: Kysely<Database>,
  ctx: WorkspaceContext,
  pref: NotificationPreference,
  now: Date,
  notifier: Notifier,
): Promise<boolean> {
  if (!pref.streak_nudges_enabled) return false;

  const hour = Number(localTime(ctx.timezone, now).slice(0, 2));
  if (hour < STREAK_RISK_HOUR) return false;

  const today = localDate(ctx.timezone, now);
  const stats = await db
    .selectFrom("user_stats")
    .select("current_streak")
    .where("user_id", "=", ctx.userId)
    .where("workspace_id", "=", ctx.workspaceId)
    .executeTakeFirst();
  if (!stats || stats.current_streak <= 0) return false;

  const engagedToday = await db
    .selectFrom("engagement_day")
    .select("activity_date")
    .where("user_id", "=", ctx.userId)
    .where("activity_date", "=", today)
    .executeTakeFirst();
  if (engagedToday) return false;

  const claimed = await claimDispatch(db, {
    userId: ctx.userId,
    kind: "streak_at_risk",
    dedupeKey: today,
  });
  if (!claimed) return false;

  await deliverToUser(db, notifier, ctx.userId, {
    kind: "streak_at_risk",
    title: "Keep your streak alive",
    body: `You're on a ${stats.current_streak}-day streak — a moment today keeps it going.`,
    deepLink: "/morning-brief",
  });
  return true;
}

/**
 * "Milestone approaching." STUB — the "approaching" predicate needs the milestone
 * `projected_date` projection, which is Phase 6 (flow.ts defers it). The gate and
 * the `milestone_id` dedupe key are wired so enabling this is a one-liner once
 * projection exists; today it selects nothing.
 */
export async function nudgeMilestoneApproaching(
  _db: Kysely<Database>,
  _ctx: WorkspaceContext,
  pref: NotificationPreference,
  _now: Date,
  _notifier: Notifier,
): Promise<boolean> {
  if (!pref.milestone_nudges_enabled) return false;
  // TODO(Phase 6): select milestones whose projected_date is within the threshold,
  // then `claimDispatch({ kind: 'milestone_approaching', dedupeKey: milestone.id })`.
  return false;
}
