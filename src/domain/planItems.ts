/**
 * Daily-planning EDITS (api-endpoints.md §10): add / reorder / defer / remove a
 * plan item, and pull-forward a future task onto today. These are all DIRECT USER
 * actions on the plan — allowed under invariant #5 (the rule forbids a background
 * job rewriting the plan, not the user adjusting their own day).
 *
 * Two structural guards from the schema do the heavy lifting and we let them fire
 * rather than racing a pre-check:
 *   - UNIQUE (daily_plan_day_id, task_id) — a task can't be on the same day twice.
 *   - partial UNIQUE (task_id) WHERE status='planned' — a task has at most ONE
 *     planned day; "moving" it means freeing the old planned row first.
 * Blocked work is never schedulable (invariant #6) — add and pull-forward reject it.
 */
import type { Kysely, Transaction } from "kysely";
import type { Database, DailyPlanDay, DailyPlanItem } from "../db/types";
import type { AuthContext } from "../auth/context";
import { withTransaction, type Executor } from "../db/transaction";
import { conflict, notFound, unprocessable, badRequest } from "../lib/errors";
import { localDate } from "../lib/dates";
import { getBlockedTaskIds } from "./blocked";
import { recordEngagement, refreshStats } from "./engagement";
import { getOrCreateDay } from "./planDays";

async function engage(trx: Transaction<Database>, ctx: AuthContext, today: string, now: Date): Promise<void> {
  await recordEngagement(trx, { userId: ctx.userId, workspaceId: ctx.workspaceId, localDate: today, now });
  await refreshStats(trx, { userId: ctx.userId, workspaceId: ctx.workspaceId, localToday: today, now });
}

/** A task must exist in the workspace and not be blocked before it can be scheduled. */
async function assertSchedulable(
  db: Executor,
  ctx: AuthContext,
  taskId: string,
): Promise<void> {
  const task = await db
    .selectFrom("task")
    .select("id")
    .where("id", "=", taskId)
    .where("workspace_id", "=", ctx.workspaceId)
    .executeTakeFirst();
  if (!task) throw notFound("Task not found");
  const blocked = await getBlockedTaskIds(db, ctx);
  if (blocked.has(taskId)) throw unprocessable("Task is blocked by an incomplete predecessor");
}

/** Add a task to a day (origin='user_added'). ⚡eng. */
export async function addItem(
  db: Kysely<Database>,
  ctx: AuthContext,
  date: string,
  taskId: string,
  position: number | null,
  now: Date = new Date(),
): Promise<DailyPlanItem> {
  await assertSchedulable(db, ctx, taskId);
  const today = localDate(ctx.timezone, now);

  return withTransaction(db, async (trx) => {
    const day = await getOrCreateDay(trx, ctx, date, now);
    // UNIQUE(day,task) → 409 dup; partial-unique(task) WHERE planned → 409 planned
    // elsewhere. Both are mapped by mapDbError; we don't pre-check and race.
    const item = await trx
      .insertInto("daily_plan_item")
      .values({
        workspace_id: ctx.workspaceId,
        daily_plan_day_id: day.id,
        item_type: "task",
        task_id: taskId,
        status: "planned",
        origin: "user_added",
        position: position ?? 0,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await engage(trx, ctx, today, now);
    return item;
  });
}

/** Reorder an item and/or mark it deferred (Principle 3: never penalized). */
export async function patchItem(
  db: Kysely<Database>,
  ctx: AuthContext,
  itemId: string,
  patch: { position?: number; status?: string },
): Promise<DailyPlanItem> {
  if (patch.status != null && patch.status !== "deferred") {
    throw unprocessable("status can only be set to 'deferred' here (completion is via task complete)");
  }
  if (patch.position == null && patch.status == null) {
    throw badRequest("Provide at least one of position, status");
  }

  return withTransaction(db, async (trx) => {
    const item = await trx
      .selectFrom("daily_plan_item")
      .selectAll()
      .where("id", "=", itemId)
      .where("workspace_id", "=", ctx.workspaceId)
      .executeTakeFirst();
    if (!item) throw notFound("Plan item not found");
    if (item.status === "completed") {
      throw conflict("A completed item cannot be reordered or deferred");
    }

    const update: { position?: number; status?: "deferred"; updated_at: Date } = { updated_at: new Date() };
    if (patch.position != null) update.position = patch.position;
    if (patch.status === "deferred") update.status = "deferred";

    return trx
      .updateTable("daily_plan_item")
      .set(update)
      .where("id", "=", itemId)
      .returningAll()
      .executeTakeFirstOrThrow();
  });
}

/** Remove an item from a day (defer without target). The projection re-picks it up. ⚡eng. */
export async function deleteItem(
  db: Kysely<Database>,
  ctx: AuthContext,
  itemId: string,
  now: Date = new Date(),
): Promise<void> {
  const today = localDate(ctx.timezone, now);
  await withTransaction(db, async (trx) => {
    const item = await trx
      .selectFrom("daily_plan_item")
      .select(["id", "status"])
      .where("id", "=", itemId)
      .where("workspace_id", "=", ctx.workspaceId)
      .executeTakeFirst();
    if (!item) throw notFound("Plan item not found");
    if (item.status === "completed") {
      throw conflict("A completed item cannot be removed (it carries scoring history)");
    }
    await trx.deleteFrom("daily_plan_item").where("id", "=", itemId).execute();
    await engage(trx, ctx, today, now);
  });
}

/** Lock/unlock a day — off-limits to the planner and replan proposals when locked. */
export async function setDayLock(
  db: Kysely<Database>,
  ctx: AuthContext,
  date: string,
  isLocked: boolean,
): Promise<DailyPlanDay> {
  const day = await db
    .selectFrom("daily_plan_day")
    .select("id")
    .where("workspace_id", "=", ctx.workspaceId)
    .where("plan_date", "=", date)
    .executeTakeFirst();
  if (!day) throw notFound("No plan day for that date");
  return db
    .updateTable("daily_plan_day")
    .set({ is_locked: isLocked, updated_at: new Date() })
    .where("id", "=", day.id)
    .returningAll()
    .executeTakeFirstOrThrow();
}

export interface PullForwardResult {
  item: DailyPlanItem;
  day: DailyPlanDay;
}

/** Work ahead: pull a task onto the target day (default today), origin='pulled_forward'. ⚡eng. */
export async function pullForward(
  db: Kysely<Database>,
  ctx: AuthContext,
  taskId: string,
  toDate: string | null,
  now: Date = new Date(),
): Promise<PullForwardResult> {
  await assertSchedulable(db, ctx, taskId);
  const today = localDate(ctx.timezone, now);
  const target = toDate ?? today;

  return withTransaction(db, async (trx) => {
    const day = await getOrCreateDay(trx, ctx, target, now);

    const already = await trx
      .selectFrom("daily_plan_item")
      .select("id")
      .where("workspace_id", "=", ctx.workspaceId)
      .where("daily_plan_day_id", "=", day.id)
      .where("task_id", "=", taskId)
      .executeTakeFirst();
    if (already) throw conflict("Task is already on the target day");

    // Free any existing PLANNED placement first so the partial-unique (one planned
    // day per task) admits the new pulled-forward row. The old item is marked
    // deferred — history preserved, never penalized (Principle 3).
    await trx
      .updateTable("daily_plan_item")
      .set({ status: "deferred", updated_at: now })
      .where("workspace_id", "=", ctx.workspaceId)
      .where("task_id", "=", taskId)
      .where("status", "=", "planned")
      .execute();

    const item = await trx
      .insertInto("daily_plan_item")
      .values({
        workspace_id: ctx.workspaceId,
        daily_plan_day_id: day.id,
        item_type: "task",
        task_id: taskId,
        status: "planned",
        origin: "pulled_forward",
        position: 0,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await engage(trx, ctx, today, now);
    return { item, day };
  });
}
