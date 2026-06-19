/**
 * Identity & account reads/writes (api-endpoints.md §2). All scoped to the caller's
 * own user + workspace via the auth context — `workspace_id` is never taken from
 * the client. These surface the already-stored identity/cache rows; the only write
 * here is `recordEngagementAction`, which reuses the existing engagement machinery.
 */
import type { Kysely } from "kysely";
import type { AppUser, Database, UserStatsTable, Workspace } from "../db/types";
import type { Selectable } from "kysely";
import type { AuthContext } from "../auth/context";
import { withTransaction } from "../db/transaction";
import { notFound } from "../lib/errors";
import { localDate } from "../lib/dates";
import { recordEngagement, refreshStats } from "./engagement";

export interface MeView {
  user: AppUser;
  workspace: Workspace;
  role: string;
}

/** GET /me — profile + workspace context (pure read). */
export async function getMe(db: Kysely<Database>, ctx: AuthContext): Promise<MeView> {
  const user = await db
    .selectFrom("app_user")
    .selectAll()
    .where("id", "=", ctx.userId)
    .executeTakeFirst();
  if (!user) throw notFound("User not found");

  const workspace = await db
    .selectFrom("workspace")
    .selectAll()
    .where("id", "=", ctx.workspaceId)
    .executeTakeFirstOrThrow();

  return { user, workspace, role: ctx.role };
}

export interface UpdateMeInput {
  display_name?: string | null;
  timezone?: string;
}

/**
 * PATCH /me — update display_name / timezone. A timezone change shifts the
 * midnight-local boundary GOING FORWARD only (invariant #3): nothing derived is
 * stored, so existing `activity_date` / `plan_date` rows (already frozen at write
 * time in the old zone) are untouched, and every future `localDate(...)` simply
 * reads the new zone. There is deliberately no backfill.
 */
export async function updateMe(
  db: Kysely<Database>,
  ctx: AuthContext,
  input: UpdateMeInput,
  now: Date = new Date(),
): Promise<AppUser> {
  const patch: { display_name?: string | null; timezone?: string; updated_at: Date } = {
    updated_at: now,
  };
  if (input.display_name !== undefined) patch.display_name = input.display_name;
  if (input.timezone !== undefined) patch.timezone = input.timezone;

  return db
    .updateTable("app_user")
    .set(patch)
    .where("id", "=", ctx.userId)
    .returningAll()
    .executeTakeFirstOrThrow();
}

export type StatsView = Pick<
  Selectable<UserStatsTable>,
  | "total_points"
  | "current_streak"
  | "longest_streak"
  | "last_engaged_date"
  | "global_capacity_hours_per_day"
>;

/** GET /me/stats — single-row read of the denormalized cache (data-model §4.6). */
export async function getStats(db: Kysely<Database>, ctx: AuthContext): Promise<StatsView> {
  const stats = await db
    .selectFrom("user_stats")
    .select([
      "total_points",
      "current_streak",
      "longest_streak",
      "last_engaged_date",
      "global_capacity_hours_per_day",
    ])
    .where("user_id", "=", ctx.userId)
    .where("workspace_id", "=", ctx.workspaceId)
    .executeTakeFirst();
  // Bootstrap seeds a zeroed row, so absence means a non-provisioned user.
  if (!stats) throw notFound("Stats not found");
  return stats;
}

export interface EngagementResult {
  activity_date: string;
  current_streak: number;
}

/**
 * POST /me/engagement ⚡eng — idempotent upsert of today's (local) engagement_day,
 * then a stats refresh, in one transaction. Reuses the shared engagement helpers
 * (do NOT reimplement): a second call the same local day is a no-op on the row.
 */
export async function recordEngagementAction(
  db: Kysely<Database>,
  ctx: AuthContext,
  now: Date = new Date(),
): Promise<EngagementResult> {
  const today = localDate(ctx.timezone, now);
  return withTransaction(db, async (trx) => {
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
    const stats = await trx
      .selectFrom("user_stats")
      .select("current_streak")
      .where("user_id", "=", ctx.userId)
      .where("workspace_id", "=", ctx.workspaceId)
      .executeTakeFirstOrThrow();
    return { activity_date: today, current_streak: stats.current_streak };
  });
}
