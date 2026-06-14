/**
 * Roadmap & day READS (api-endpoints.md §10). `getRoadmap` assembles the
 * Duolingo-style path: persisted past/confirmed days from the tables UNION the
 * live projection for everything beyond, milestones as landmarks with their
 * derived `projected_date`, and the "you are here" position. The projection is
 * read-only (data-model §6) — nothing here writes a plan row.
 *
 * `getDay` is the Companion's main read; viewing TODAY is a qualifying engagement
 * (Decision #8), so it records ⚡eng — the one write on this path, and a user action.
 */
import type { Kysely } from "kysely";
import type { Database, DailyPlanDay, DailyPlanItem, DayStatus } from "../db/types";
import type { AuthContext } from "../auth/context";
import { withTransaction } from "../db/transaction";
import { notFound } from "../lib/errors";
import { localDate } from "../lib/dates";
import { recordEngagement, refreshStats } from "./engagement";
import { projectSchedule } from "./projection";

export interface RoadmapTaskRef {
  id: string;
  title: string;
  status: string;
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
  status: DayStatus | "projected";
  is_locked: boolean;
  projected: boolean;
  items: RoadmapItem[];
}

export interface Roadmap {
  days: RoadmapDay[];
  milestones: { id: string; projected_date: string | null }[];
  position: { today: string; current_streak: number };
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
        .leftJoin("task as t", "t.id", "i.task_id")
        .select([
          "i.daily_plan_day_id as dayId",
          "i.task_id as taskId",
          "i.status as status",
          "i.origin as origin",
          "i.position as position",
          "t.id as tId",
          "t.title as tTitle",
          "t.status as tStatus",
        ])
        .where("i.workspace_id", "=", ctx.workspaceId)
        .where("i.daily_plan_day_id", "in", dayIds)
        .orderBy("i.position")
        .execute()
    : [];

  // Slipped days don't "hold" their work — the same task is re-projected forward, so
  // it must NOT be deduped out of the projected region (it shows both historically on
  // the slipped day and ahead on its new projected day). Mirrors projection.ts.
  const slippedDayIds = new Set(persistedDays.filter((d) => d.status === "slipped").map((d) => d.id));

  const itemsByDay = new Map<string, RoadmapItem[]>();
  const persistedPlannedTasks = new Set<string>();
  for (const r of itemRows) {
    const list = itemsByDay.get(r.dayId) ?? itemsByDay.set(r.dayId, []).get(r.dayId)!;
    list.push({
      task_id: r.taskId ?? "",
      task: r.tId ? { id: r.tId, title: r.tTitle ?? "", status: r.tStatus ?? "" } : null,
      status: r.status,
      origin: r.origin,
      position: r.position,
    });
    if (r.taskId && r.status === "planned" && !slippedDayIds.has(r.dayId)) {
      persistedPlannedTasks.add(r.taskId);
    }
  }

  const days: RoadmapDay[] = persistedDays.map((d) => ({
    date: d.plan_date,
    status: d.status,
    is_locked: d.is_locked,
    projected: false,
    items: itemsByDay.get(d.id) ?? [],
  }));

  // --- Projection for everything beyond the last persisted day. ---
  const { draft, milestoneDate } = await projectSchedule(db, ctx, {
    now,
    goalId: opts.goalId,
  });
  const lastPersisted = persistedDays.length
    ? persistedDays[persistedDays.length - 1]!.plan_date
    : null;

  // Task refs for projected items (titles/status), fetched once.
  const projectedTaskIds = new Set<string>();
  for (const d of draft) {
    if (lastPersisted && d.planDate <= lastPersisted) continue;
    if (opts.to && d.planDate > opts.to) continue;
    for (const it of d.items) {
      if (!persistedPlannedTasks.has(it.taskId)) projectedTaskIds.add(it.taskId);
    }
  }
  const taskRefs = projectedTaskIds.size
    ? await db
        .selectFrom("task")
        .select(["id", "title", "status"])
        .where("workspace_id", "=", ctx.workspaceId)
        .where("id", "in", [...projectedTaskIds])
        .execute()
    : [];
  const refById = new Map(taskRefs.map((t) => [t.id, t]));

  for (const d of draft) {
    if (lastPersisted && d.planDate <= lastPersisted) continue;
    if (opts.to && d.planDate > opts.to) continue;
    const items: RoadmapItem[] = [];
    let position = 0;
    for (const it of d.items) {
      if (persistedPlannedTasks.has(it.taskId)) continue; // already shown on a persisted day
      const ref = refById.get(it.taskId);
      items.push({
        task_id: it.taskId,
        task: ref ? { id: ref.id, title: ref.title, status: ref.status } : null,
        status: "planned",
        origin: "proposed",
        position: position++,
      });
    }
    if (items.length > 0) days.push({ date: d.planDate, status: "projected", is_locked: false, projected: true, items });
  }

  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // --- Milestones in scope as landmarks with their derived projected_date. ---
  let msQ = db
    .selectFrom("milestone as m")
    .innerJoin("project as p", "p.id", "m.project_id")
    .select(["m.id as id"])
    .where("m.workspace_id", "=", ctx.workspaceId)
    .where("p.status", "=", "active");
  if (opts.goalId) msQ = msQ.where("p.goal_id", "=", opts.goalId);
  const msRows = await msQ.execute();
  const milestones = msRows.map((m) => ({
    id: m.id,
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

/** A persisted day + its Daily Goals. Viewing TODAY records ⚡eng (Decision #8). */
export async function getDay(
  db: Kysely<Database>,
  ctx: AuthContext,
  date: string,
  now: Date = new Date(),
): Promise<DayView> {
  const day = await db
    .selectFrom("daily_plan_day")
    .selectAll()
    .where("workspace_id", "=", ctx.workspaceId)
    .where("plan_date", "=", date)
    .executeTakeFirst();
  if (!day) throw notFound("No plan day for that date");

  const rows = await db
    .selectFrom("daily_plan_item as i")
    .leftJoin("task as t", "t.id", "i.task_id")
    .selectAll("i")
    .select(["t.id as tId", "t.title as tTitle", "t.status as tStatus"])
    .where("i.workspace_id", "=", ctx.workspaceId)
    .where("i.daily_plan_day_id", "=", day.id)
    .orderBy("i.position")
    .execute();

  const items = rows.map((r) => {
    const { tId, tTitle, tStatus, ...item } = r;
    return {
      item: item as unknown as DailyPlanItem,
      task: tId ? { id: tId, title: tTitle ?? "", status: tStatus ?? "" } : null,
    };
  });

  // ⚡eng: viewing today's plan is a qualifying engagement.
  const today = localDate(ctx.timezone, now);
  if (date === today) {
    await withTransaction(db, async (trx) => {
      await recordEngagement(trx, { userId: ctx.userId, workspaceId: ctx.workspaceId, localDate: today, now });
      await refreshStats(trx, { userId: ctx.userId, workspaceId: ctx.workspaceId, localToday: today, now });
    });
  }

  return { day, items };
}
