/**
 * Morning-brief push (api §13, Journey B/D). Per-user, at the user's local
 * `morning_brief_time`. The notification just points the Companion at
 * `GET /morning-brief` (the signature composite read) — it carries no plan state.
 *
 * Catch-up over exact timing (the serverless reality): we do NOT depend on a tick
 * landing exactly on the configured minute. Selection is ledger-driven — "the
 * user's local wall-clock is at/past their brief time today AND we haven't sent
 * today's brief yet". A skipped tick simply sends late on the next one, once; the
 * `(user, 'morning_brief', localDate)` ledger row guarantees exactly-once per day.
 */
import type { Kysely } from "kysely";
import type { Database, NotificationPreference } from "../../db/types";
import type { WorkspaceContext } from "../../auth/context";
import { localDate, localTime } from "../../lib/dates";
import { claimDispatch, deliverToUser } from "./dispatch";
import type { Notifier } from "./notifier";

/** True iff `localTime` (HH:MM) is at or past the preference time ('HH:MM:SS'). */
function briefTimeReached(nowLocal: string, briefTime: string): boolean {
  return nowLocal >= briefTime.slice(0, 5);
}

/**
 * Send the user's morning brief if it's due and unsent today. Returns true iff a
 * notification was actually dispatched (claim won + at least the send attempted).
 */
export async function sendMorningBrief(
  db: Kysely<Database>,
  ctx: WorkspaceContext,
  pref: NotificationPreference,
  now: Date,
  notifier: Notifier,
): Promise<boolean> {
  if (!pref.morning_brief_enabled) return false; // flag off → never sent (don't nag).

  const today = localDate(ctx.timezone, now);
  if (!briefTimeReached(localTime(ctx.timezone, now), pref.morning_brief_time)) return false;

  // Claim today's slot first; a lost claim (already sent / concurrent tick) → no send.
  const claimed = await claimDispatch(db, {
    userId: ctx.userId,
    kind: "morning_brief",
    dedupeKey: today,
  });
  if (!claimed) return false;

  await deliverToUser(db, notifier, ctx.userId, {
    kind: "morning_brief",
    title: "Good morning",
    body: "Here's your plan for today.",
    deepLink: "/morning-brief",
  });
  return true;
}
