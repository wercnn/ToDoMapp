/**
 * Notification preferences (api-endpoints.md §3). A 1:1 row per user, seeded with
 * defaults at bootstrap. GET is a pure read; PUT is a FULL REPLACE of the toggles +
 * morning-brief time (local wall-clock; the scheduler resolves it via the user's
 * timezone). Scoped to `ctx.userId`.
 */
import type { Kysely } from "kysely";
import type { Database, NotificationPreference } from "../db/types";
import type { AuthContext } from "../auth/context";
import { notFound } from "../lib/errors";

/** GET /me/notification-preferences — the 1:1 row. */
export async function getPrefs(
  db: Kysely<Database>,
  ctx: AuthContext,
): Promise<NotificationPreference> {
  const pref = await db
    .selectFrom("notification_preference")
    .selectAll()
    .where("user_id", "=", ctx.userId)
    .executeTakeFirst();
  if (!pref) throw notFound("Notification preferences not found");
  return pref;
}

export interface PrefsInput {
  morning_brief_enabled: boolean;
  morning_brief_time: string;
  milestone_nudges_enabled: boolean;
  replan_nudges_enabled: boolean;
  streak_nudges_enabled: boolean;
}

/** PUT /me/notification-preferences — full replace of every field. */
export async function replacePrefs(
  db: Kysely<Database>,
  ctx: AuthContext,
  input: PrefsInput,
  now: Date = new Date(),
): Promise<NotificationPreference> {
  return db
    .updateTable("notification_preference")
    .set({
      morning_brief_enabled: input.morning_brief_enabled,
      morning_brief_time: input.morning_brief_time,
      milestone_nudges_enabled: input.milestone_nudges_enabled,
      replan_nudges_enabled: input.replan_nudges_enabled,
      streak_nudges_enabled: input.streak_nudges_enabled,
      updated_at: now,
    })
    .where("user_id", "=", ctx.userId)
    .returningAll()
    .executeTakeFirstOrThrow();
}
