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
 * All three are FULLY WIRED:
 *   - replan_needs_review  — reads `replan_proposal`.
 *   - streak_at_risk       — reads `user_stats` + `engagement_day`.
 *   - milestone_approaching— uses the shared `scheduledMilestoneDates` (real plan)
 *     ; fires when a milestone's derived projected_date falls
 *     within MILESTONE_APPROACHING_DAYS of local today. (Was stubbed in Phase 5 only
 *     because the projection it depends on didn't exist yet.)
 */
import type { Kysely } from "kysely";
import type { Database, NotificationPreference } from "../../db/types";
import type { WorkspaceContext } from "../../auth/context";
import { addDays, localDate, localTime } from "../../lib/dates";
import { scheduledMilestoneDates } from "../scheduleDates";
import { claimDispatch, deliverToUser } from "./dispatch";
import type { Notifier } from "./notifier";

/** Local hour (24h) at/after which an unengaged day is "at risk" for the streak. */
export const STREAK_RISK_HOUR = 20;

/** A milestone whose projected_date is within this many days is "approaching". */
export const MILESTONE_APPROACHING_DAYS = 7;

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
 * "Milestone approaching": a milestone whose derived projected_date falls within
 * MILESTONE_APPROACHING_DAYS of local today. Fires once per milestone (keyed on its
 * id), gated by `milestone_nudges_enabled`. ACTIVATED in Phase 6 — `projected_date`
 * now comes from the shared projection (data-model §6, computed live).
 */
export async function nudgeMilestoneApproaching(
  db: Kysely<Database>,
  ctx: WorkspaceContext,
  pref: NotificationPreference,
  now: Date,
  notifier: Notifier,
): Promise<boolean> {
  if (!pref.milestone_nudges_enabled) return false;

  const today = localDate(ctx.timezone, now);
  const cutoff = addDays(today, MILESTONE_APPROACHING_DAYS);
  const projectedDates = await scheduledMilestoneDates(db, ctx, { now });

  // Earliest approaching milestone first (deterministic when several qualify).
  const approaching = [...projectedDates.entries()]
    .filter(([, date]) => date != null && date >= today && date <= cutoff)
    .sort((a, b) => (a[1]! < b[1]! ? -1 : a[1]! > b[1]! ? 1 : 0));

  for (const [milestoneId, date] of approaching) {
    const claimed = await claimDispatch(db, {
      userId: ctx.userId,
      kind: "milestone_approaching",
      dedupeKey: milestoneId,
    });
    if (!claimed) continue;
    await deliverToUser(db, notifier, ctx.userId, {
      kind: "milestone_approaching",
      title: "A milestone is coming up",
      body: `You're on track to reach a milestone around ${date}.`,
      deepLink: "/roadmap",
    });
    return true;
  }
  return false;
}
