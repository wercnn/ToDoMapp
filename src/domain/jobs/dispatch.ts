/**
 * The notification idempotency ledger (`notification_dispatch`). Serverless crons
 * fire late, twice, or skip ticks; this is the "send once ever" backstop.
 *
 * The contract is claim-then-send: a job CLAIMS a (user, kind, dedupe_key) row via
 * INSERT … ON CONFLICT DO NOTHING and only delivers when the claim WINS. A re-run
 * loses the claim (conflict) and sends nothing. This is at-most-once — correct for
 * notifications, where a missed nudge is benign but a double nudge is nagging.
 */
import type { Kysely } from "kysely";
import type { Database, Device, NotificationKind, NotificationPreference } from "../../db/types";
import type { Executor } from "../../db/transaction";
import type { NotificationPayload, Notifier } from "./notifier";

/**
 * Atomically claim the right to send `(userId, kind, dedupeKey)`. Returns true iff
 * THIS call inserted the row (i.e. it is the first/only sender). A losing claim
 * returns false and the caller must not send.
 */
export async function claimDispatch(
  db: Executor,
  args: { userId: string; kind: NotificationKind; dedupeKey: string },
): Promise<boolean> {
  const inserted = await db
    .insertInto("notification_dispatch")
    .values({ user_id: args.userId, kind: args.kind, dedupe_key: args.dedupeKey })
    .onConflict((oc) => oc.constraint("notification_dispatch_once").doNothing())
    .returning("id")
    .executeTakeFirst();
  return inserted !== undefined;
}

/** The user's registered push endpoints. */
export async function getDevices(db: Kysely<Database>, userId: string): Promise<Device[]> {
  return db
    .selectFrom("device")
    .selectAll()
    .where("user_id", "=", userId)
    .execute();
}

/** Fan a payload out to every registered device for a user. */
export async function deliverToUser(
  db: Kysely<Database>,
  notifier: Notifier,
  userId: string,
  payload: NotificationPayload,
): Promise<void> {
  const devices = await getDevices(db, userId);
  for (const d of devices) {
    await notifier.send({ pushToken: d.push_token, platform: d.platform }, payload);
  }
}

/** The user's notification settings (always present — bootstrap seeds defaults). */
export async function getPreferences(
  db: Kysely<Database>,
  userId: string,
): Promise<NotificationPreference | undefined> {
  return db
    .selectFrom("notification_preference")
    .selectAll()
    .where("user_id", "=", userId)
    .executeTakeFirst();
}
