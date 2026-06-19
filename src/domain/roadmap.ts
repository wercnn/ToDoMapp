/**
 * Roadmap service (api-endpoints.md §10). Assembles the planner's input from the
 * DB (candidate tasks, blocked-state, per-project capacity) and persists the
 * draft. The planner itself stays a pure function behind its interface
 * (Decision #19) — this is the only place that knows how to read capacity off the
 * project table and feed it in as a parameter.
 *
 * Re-running /propose replaces only `proposed`, unlocked days; `confirmed` and
 * locked days are never altered (Principle 1).
 */
import type { Kysely } from "kysely";
import type { Database, DailyPlanDay, DailyPlanItem } from "../db/types";
import type { AuthContext } from "../auth/context";
import { withTransaction } from "../db/transaction";
import { conflict, notFound } from "../lib/errors";
import { addDays, localDate } from "../lib/dates";
import { planner } from "../planner/index";
import { resolveHours } from "../planner/constants";
import { getBlockedTaskIds } from "./blocked";
import { recordEngagement, refreshStats } from "./engagement";
import { confirmedDayValues } from "./planDays";

const DEFAULT_HORIZON_DAYS = 7;

export interface ProposedDay {
  day: DailyPlanDay;
  items: DailyPlanItem[];
}

export async function proposeRoadmap(
  db: Kysely<Database>,
  ctx: AuthContext,
  opts: { horizonDays?: number; goalId?: string; now?: Date } = {},
): Promise<ProposedDay[]> {
  const now = opts.now ?? new Date();
  const startDate = localDate(ctx.timezone, now);
  const horizonDays = opts.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const endDate = addDays(startDate, horizonDays - 1);

  // --- Assemble candidates: open todo tasks in active projects. ---
  let candQ = db
    .selectFrom("task as t")
    .innerJoin("work_package as wp", "wp.id", "t.work_package_id")
    .innerJoin("project as p", "p.id", "wp.project_id")
    .select([
      "t.id as taskId",
      "p.id as projectId",
      "t.estimate_hours as estimateHours",
      "t.difficulty as difficulty",
      "t.is_time_fixed as isTimeFixed",
      "t.fixed_date as fixedDate",
      "t.position as position",
    ])
    .where("t.workspace_id", "=", ctx.workspaceId)
    .where("t.status", "=", "todo")
    .where("t.replaced_at", "is", null)
    .where("p.status", "=", "active")
    .where("wp.completed_at", "is", null);
  if (opts.goalId) candQ = candQ.where("p.goal_id", "=", opts.goalId);
  const rows = await candQ.execute();

  const blocked = await getBlockedTaskIds(db, ctx);

  // Tasks already actively planned (on confirmed/locked days, or anywhere) stay
  // put — exclude from a fresh proposal so the partial-unique "one planned day
  // per task" is never violated.
  const plannedRows = await db
    .selectFrom("daily_plan_item")
    .select("task_id")
    .where("workspace_id", "=", ctx.workspaceId)
    .where("status", "=", "planned")
    .where("task_id", "is not", null)
    .execute();
  const plannedSet = new Set(plannedRows.map((r) => r.task_id));

  const candidates = rows
    .filter((r) => !plannedSet.has(r.taskId))
    .map((r) => ({
      taskId: r.taskId,
      projectId: r.projectId,
      hours: resolveHours(r.estimateHours != null ? Number(r.estimateHours) : null, r.difficulty),
      isTimeFixed: r.isTimeFixed,
      fixedDate: r.fixedDate,
      blocked: blocked.has(r.taskId),
      position: r.position,
    }));

  // --- Capacity (read here, passed to the planner as a parameter). ---
  const capRows = await db
    .selectFrom("project")
    .select(["id", "capacity_hours_per_day"])
    .where("workspace_id", "=", ctx.workspaceId)
    .where("status", "=", "active")
    .execute();
  const capacities = capRows.map((c) => ({
    projectId: c.id,
    hoursPerDay: Number(c.capacity_hours_per_day),
  }));

  const draft = planner.proposeDays({ startDate, horizonDays, candidates, capacities });

  // --- Persist: replace proposed/unlocked days in the window, keep the rest. ---
  return withTransaction(db, async (trx) => {
    await trx
      .deleteFrom("daily_plan_day")
      .where("workspace_id", "=", ctx.workspaceId)
      .where("status", "=", "proposed")
      .where("is_locked", "=", false)
      .where("plan_date", ">=", startDate)
      .where("plan_date", "<=", endDate)
      .execute();

    const result: ProposedDay[] = [];
    for (const d of draft) {
      const existing = await trx
        .selectFrom("daily_plan_day")
        .select(["id", "status", "is_locked"])
        .where("workspace_id", "=", ctx.workspaceId)
        .where("plan_date", "=", d.planDate)
        .executeTakeFirst();
      // A confirmed or locked day on this date is off-limits — skip it.
      if (existing && (existing.status !== "proposed" || existing.is_locked)) continue;

      const day = existing
        ? await trx
            .selectFrom("daily_plan_day")
            .selectAll()
            .where("id", "=", existing.id)
            .executeTakeFirstOrThrow()
        : await trx
            .insertInto("daily_plan_day")
            .values({ workspace_id: ctx.workspaceId, plan_date: d.planDate, status: "proposed" })
            .returningAll()
            .executeTakeFirstOrThrow();

      const items: DailyPlanItem[] = [];
      let position = 0;
      for (const it of d.items) {
        const item = await trx
          .insertInto("daily_plan_item")
          .values({
            workspace_id: ctx.workspaceId,
            daily_plan_day_id: day.id,
            item_type: "task",
            task_id: it.taskId,
            status: "planned",
            origin: "proposed",
            position: position++,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        items.push(item);
      }
      result.push({ day, items });
    }
    return result;
  });
}

/** Confirm a proposed day: proposed → confirmed (the only path to the roadmap path). */
export async function confirmDay(
  db: Kysely<Database>,
  ctx: AuthContext,
  date: string,
  now: Date = new Date(),
): Promise<DailyPlanDay> {
  const today = localDate(ctx.timezone, now);
  return withTransaction(db, async (trx) => {
    const day = await trx
      .selectFrom("daily_plan_day")
      .selectAll()
      .where("workspace_id", "=", ctx.workspaceId)
      .where("plan_date", "=", date)
      .executeTakeFirst();
    if (!day) throw notFound("No plan day for that date");
    if (day.status !== "proposed") {
      throw conflict(`Day is '${day.status}', not 'proposed' — cannot confirm`);
    }

    const updated = await trx
      .updateTable("daily_plan_day")
      .set(confirmedDayValues(now))
      .where("id", "=", day.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    // ⚡eng: confirming is a qualifying engagement.
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

    return updated;
  });
}
