/**
 * Roadmap & day READS (api-endpoints.md §10). `getRoadmap` assembles the
 * Duolingo-style path from the PERSISTED plan days only — all work now always sits
 * on a concrete day (new work lands on tomorrow; replan moves it), so there is no
 * read-only projection appended after the confirmed days. Milestones are landmarks
 * with their plan-derived `projected_date`. Read-only — nothing here writes a row.
 *
 * `getDay` is the Companion's main read; viewing TODAY is a qualifying engagement
 * (Decision #8), so it records ⚡eng — the one write on this path, and a user action.
 */
import type { Kysely } from "kysely";
import type { Database, DailyPlanDay, DailyPlanItem, DayStatus, DifficultyLevel, TaskStatus } from "../db/types";
import type { AuthContext } from "../auth/context";
import { withTransaction, type Executor } from "../db/transaction";
import { notFound } from "../lib/errors";
import { localDate } from "../lib/dates";
import { recordEngagement, refreshStats } from "./engagement";
import { scheduledMilestoneDates } from "./scheduleDates";
import { getBlockedTaskIds } from "./blocked";

export interface RoadmapTaskRef {
  id: string;
  title: string;
  status: TaskStatus;
  project_id: string;
  project_title: string;
  work_package_id: string;
  work_package_title: string;
  estimate_hours: string | null;
  difficulty: DifficultyLevel | null;
  is_time_fixed: boolean;
  fixed_date: string | null;
  original_task_id: string | null;
  split_index: number | null;
  split_count: number | null;
  is_split_part: boolean;
  replaced_at: Date | string | null;
  blocked: boolean;
}

export interface RoadmapItem {
  task_id: string;
  task: RoadmapTaskRef | null;
  status: string | null;
  origin: string | null;
  position: number;
}

export interface RoadmapDay {
  date: string;
  status: DayStatus;
  is_locked: boolean;
  items: RoadmapItem[];
}

export interface Roadmap {
  days: RoadmapDay[];
  milestones: {
    id: string;
    title: string;
    achieved: boolean;
    /** Local date the milestone was achieved (from achieved_at); null until achieved. */
    achieved_date: string | null;
    /** Derived projection of the finish date; null once achieved (no future work to date). */
    projected_date: string | null;
  }[];
  position: { today: string; current_streak: number };
}

export async function readTaskRefs(
  db: Executor,
  ctx: AuthContext,
  taskIds: string[],
): Promise<Map<string, RoadmapTaskRef>> {
  const ids = [...new Set(taskIds.filter(Boolean))];
  if (ids.length === 0) return new Map();

  const [rows, blockedIds] = await Promise.all([
    db
      .selectFrom("task as t")
      .innerJoin("work_package as wp", "wp.id", "t.work_package_id")
      .innerJoin("project as p", "p.id", "wp.project_id")
      .select([
        "t.id as id",
        "t.title as title",
        "t.status as status",
        "t.estimate_hours as estimate_hours",
        "t.difficulty as difficulty",
        "t.is_time_fixed as is_time_fixed",
        "t.fixed_date as fixed_date",
        "t.original_task_id as original_task_id",
        "t.split_index as split_index",
        "t.split_count as split_count",
        "t.is_split_part as is_split_part",
        "t.replaced_at as replaced_at",
        "wp.id as work_package_id",
        "wp.title as work_package_title",
        "p.id as project_id",
        "p.title as project_title",
      ])
      .where("t.workspace_id", "=", ctx.workspaceId)
      .where("t.id", "in", ids)
      .execute(),
    getBlockedTaskIds(db, ctx),
  ]);

  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        title: row.title,
        status: row.status,
        project_id: row.project_id,
        project_title: row.project_title,
        work_package_id: row.work_package_id,
        work_package_title: row.work_package_title,
        estimate_hours: row.estimate_hours,
        difficulty: row.difficulty,
        is_time_fixed: row.is_time_fixed,
        fixed_date: row.fixed_date,
        original_task_id: row.original_task_id,
        split_index: row.split_index,
        split_count: row.split_count,
        is_split_part: row.is_split_part,
        replaced_at: row.replaced_at,
        blocked: blockedIds.has(row.id),
      },
    ]),
  );
}

export async function getRoadmap(
  db: Kysely<Database>,
  ctx: AuthContext,
  opts: { from?: string; to?: string; goalId?: string; now?: Date } = {},
): Promise<Roadmap> {
  const now = opts.now ?? new Date();
  const today = localDate(ctx.timezone, now);

  // --- Persisted days (+ their items + task refs) in range. ---
  let dayQ = db
    .selectFrom("daily_plan_day")
    .select(["id", "plan_date", "status", "is_locked"])
    .where("workspace_id", "=", ctx.workspaceId);
  if (opts.from) dayQ = dayQ.where("plan_date", ">=", opts.from);
  if (opts.to) dayQ = dayQ.where("plan_date", "<=", opts.to);
  const persistedDays = await dayQ.orderBy("plan_date").execute();
  const dayIds = persistedDays.map((d) => d.id);

  const itemRows = dayIds.length
    ? await db
        .selectFrom("daily_plan_item as i")
        .select([
          "i.daily_plan_day_id as dayId",
          "i.task_id as taskId",
          "i.status as status",
          "i.origin as origin",
          "i.position as position",
        ])
        .where("i.workspace_id", "=", ctx.workspaceId)
        .where("i.daily_plan_day_id", "in", dayIds)
        .orderBy("i.position")
        .execute()
    : [];
  const persistedRefs = await readTaskRefs(
    db,
    ctx,
    itemRows.map((row) => row.taskId).filter((id): id is string => id != null),
  );

  const itemsByDay = new Map<string, RoadmapItem[]>();
  for (const r of itemRows) {
    // A 'deferred' item is the history trace of a task MOVED off this day (replan apply
    // defers rather than deletes — Principle 3). It's no longer on this day, so it must
    // NOT be listed or counted; the task reappears on its new persisted day.
    if (r.status === "deferred") continue;
    const list = itemsByDay.get(r.dayId) ?? itemsByDay.set(r.dayId, []).get(r.dayId)!;
    list.push({
      task_id: r.taskId ?? "",
      task: r.taskId ? persistedRefs.get(r.taskId) ?? null : null,
      status: r.status,
      origin: r.origin,
      position: r.position,
    });
  }

  // All work always sits on a concrete persisted day now, so the roadmap is simply the
  // persisted days in range — no read-only projection appended after them.
  const days: RoadmapDay[] = persistedDays
    .map((d) => ({
      date: d.plan_date,
      status: d.status,
      is_locked: d.is_locked,
      items: itemsByDay.get(d.id) ?? [],
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Milestone finish dates come straight from the plan (latest scheduled day among each
  // milestone's open tasks — see scheduleDates.ts).
  const milestoneDate = await scheduledMilestoneDates(db, ctx, { now, goalId: opts.goalId });

  // --- Milestones in scope as landmarks with their derived projected_date. ---
  let msQ = db
    .selectFrom("milestone as m")
    .innerJoin("project as p", "p.id", "m.project_id")
    .select(["m.id as id", "m.title as title", "m.achieved_at as achieved_at"])
    .where("m.workspace_id", "=", ctx.workspaceId)
    .where("p.status", "=", "active");
  if (opts.goalId) msQ = msQ.where("p.goal_id", "=", opts.goalId);
  const msRows = await msQ.execute();
  const milestones = msRows.map((m) => ({
    id: m.id,
    title: m.title,
    achieved: m.achieved_at != null,
    // Achieved milestones have no incomplete tasks left, so the projection can't date
    // them — they'd vanish from the path. Anchor them at their achievement date instead.
    achieved_date: m.achieved_at ? localDate(ctx.timezone, new Date(m.achieved_at)) : null,
    projected_date: milestoneDate.get(m.id) ?? null,
  }));

  // --- "You are here". ---
  const stats = await db
    .selectFrom("user_stats")
    .select("current_streak")
    .where("user_id", "=", ctx.userId)
    .where("workspace_id", "=", ctx.workspaceId)
    .executeTakeFirst();

  return {
    days,
    milestones,
    position: { today, current_streak: stats?.current_streak ?? 0 },
  };
}

export interface DayView {
  day: DailyPlanDay;
  items: { item: DailyPlanItem; task: RoadmapTaskRef | null }[];
}

/**
 * A persisted day + its Daily Goals — the pure read core, NO engagement side
 * effect. Returns null when no day is persisted for that date, so composite
 * callers (e.g. the morning brief) can decide their own empty-day behaviour.
 * The standalone `getDay` endpoint layers ⚡eng on top of this.
 */
export async function readDay(
  db: Kysely<Database>,
  ctx: AuthContext,
  date: string,
): Promise<DayView | null> {
  const day = await db
    .selectFrom("daily_plan_day")
    .selectAll()
    .where("workspace_id", "=", ctx.workspaceId)
    .where("plan_date", "=", date)
    .executeTakeFirst();
  if (!day) return null;

  const rows = await db
    .selectFrom("daily_plan_item as i")
    .selectAll("i")
    .where("i.workspace_id", "=", ctx.workspaceId)
    .where("i.daily_plan_day_id", "=", day.id)
    // Exclude 'deferred' history traces (a task moved off this day by a replan) so they
    // don't surface as Daily Goals in the day view / morning brief. Mirrors getRoadmap.
    .where("i.status", "<>", "deferred")
    .orderBy("i.position")
    .execute();
  const refs = await readTaskRefs(
    db,
    ctx,
    rows.map((row) => row.task_id).filter((id): id is string => id != null),
  );

  const items = rows.map((item) => ({
    item,
    task: item.task_id ? refs.get(item.task_id) ?? null : null,
  }));

  return { day, items };
}

/** A persisted day + its Daily Goals. Viewing TODAY records ⚡eng (Decision #8). */
export async function getDay(
  db: Kysely<Database>,
  ctx: AuthContext,
  date: string,
  now: Date = new Date(),
): Promise<DayView> {
  const view = await readDay(db, ctx, date);
  if (!view) throw notFound("No plan day for that date");

  // ⚡eng: viewing today's plan is a qualifying engagement.
  const today = localDate(ctx.timezone, now);
  if (date === today) {
    await withTransaction(db, async (trx) => {
      await recordEngagement(trx, { userId: ctx.userId, workspaceId: ctx.workspaceId, localDate: today, now });
      await refreshStats(trx, { userId: ctx.userId, workspaceId: ctx.workspaceId, localToday: today, now });
    });
  }

  return view;
}
