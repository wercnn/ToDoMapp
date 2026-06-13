/**
 * The single periodic tick (api §13). Vercel is serverless — there's no daemon and
 * cron is UTC-anchored, so we CANNOT express "midnight in each user's timezone" as a
 * schedule. Instead a coarse global tick (every ~15 min) sweeps every user and each
 * job decides, per user, whether it is due in that user's LOCAL time (invariant #3).
 * A single global-midnight job would be wrong: local midnight is a different instant
 * per timezone.
 *
 * Per-user jobs are state-scans, not edge-triggers, so a late or skipped tick simply
 * catches up on the next run; the dedupe ledger keeps notifications exactly-once.
 * Each user is isolated in try/catch so one bad row can't sink the whole sweep.
 */
import type { Kysely } from "kysely";
import type { Database } from "../../db/types";
import { resolveJobUsers } from "./context";
import { detectSlippageForUser } from "./slippage";
import { sendMorningBrief } from "./morningBrief";
import {
  nudgeMilestoneApproaching,
  nudgeReplanNeedsReview,
  nudgeStreakAtRisk,
} from "./nudges";
import { getPreferences } from "./dispatch";
import { pruneStaleDevices, STALE_DEVICE_DAYS } from "./prune";
import { LogNotifier, type Notifier } from "./notifier";

export interface TickResult {
  usersProcessed: number;
  daysSlipped: number;
  slippageProposals: number;
  briefsSent: number;
  nudgesSent: number;
  devicesPruned: number;
  errors: number;
}

export interface TickOptions {
  now?: Date;
  notifier?: Notifier;
  staleDeviceDays?: number;
}

export async function runTick(
  db: Kysely<Database>,
  opts: TickOptions = {},
): Promise<TickResult> {
  const now = opts.now ?? new Date();
  const notifier = opts.notifier ?? new LogNotifier();
  const result: TickResult = {
    usersProcessed: 0,
    daysSlipped: 0,
    slippageProposals: 0,
    briefsSent: 0,
    nudgesSent: 0,
    devicesPruned: 0,
    errors: 0,
  };

  const users = await resolveJobUsers(db);
  for (const ctx of users) {
    try {
      const slip = await detectSlippageForUser(db, ctx, now);
      result.daysSlipped += slip.slippedDayIds.length;
      if (slip.proposalCreated) result.slippageProposals += 1;

      // Notifications need the user's preferences (always seeded at bootstrap).
      const pref = await getPreferences(db, ctx.userId);
      if (pref) {
        if (await sendMorningBrief(db, ctx, pref, now, notifier)) result.briefsSent += 1;
        if (await nudgeReplanNeedsReview(db, ctx, pref, notifier)) result.nudgesSent += 1;
        if (await nudgeStreakAtRisk(db, ctx, pref, now, notifier)) result.nudgesSent += 1;
        if (await nudgeMilestoneApproaching(db, ctx, pref, now, notifier)) result.nudgesSent += 1;
      }
      result.usersProcessed += 1;
    } catch (err) {
      result.errors += 1;
      console.error(`[jobs] tick failed for user ${ctx.userId}:`, err);
    }
  }

  // Workspace-agnostic housekeeping, once per tick.
  result.devicesPruned = await pruneStaleDevices(db, now, opts.staleDeviceDays ?? STALE_DEVICE_DAYS);
  return result;
}
