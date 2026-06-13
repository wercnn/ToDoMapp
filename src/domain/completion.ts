/**
 * Task-completion cascade — the system's most side-effect-rich write
 * (api-endpoints.md §8). Runs as ONE transaction (invariant #7):
 *
 *   ① task → done, completed_at set (CHECK-paired)
 *   ② today's daily_plan_item for the task → completed
 *   ③ point_event(task_completed) — awarded ONCE EVER (scoring.ts guard)
 *   ④ all sibling tasks done → work_package.completed_at cache set
 *   ⑤ that completes a milestone's WP set → milestone.achieved_at set once,
 *      point_event(milestone_achieved) awarded once, celebration payload returned
 *   ⑥ day's last planned item → daily_plan_day completed, point_event(daily_goal_completed) once
 *   ⑦ engagement recorded + user_stats refreshed
 *
 * The invariant that must never break: re-completing a reopened task awards NO
 * new points. Every award goes through awardOnce → at most one point_event per
 * source, ever (data-model §4.6, invariant #8). Covered test-first.
 */
import type { Kysely } from "kysely";
import type { Database, Task } from "../db/types";
import type { AuthContext } from "../auth/context";
import { withTransaction } from "../db/transaction";
import { notFound } from "../lib/errors";
import { localDate } from "../lib/dates";
import { awardOnce } from "./scoring";
import { recordEngagement, refreshStats } from "./engagement";

export interface CompleteTaskResult {
  task: Task;
  points_awarded: number;
  day_completed?: { daily_plan_day_id: string; plan_date: string; points_awarded: number };
  milestone_achieved?: { milestone_id: string; title: string; points_awarded: number };
}

export async function completeTask(
  db: Kysely<Database>,
  ctx: AuthContext,
  taskId: string,
  now: Date = new Date(),
): Promise<CompleteTaskResult> {
  const today = localDate(ctx.timezone, now);

  return withTransaction(db, async (trx) => {
    const task = await trx
      .selectFrom("task")
      .selectAll()
      .where("id", "=", taskId)
      .where("workspace_id", "=", ctx.workspaceId)
      .executeTakeFirst();
    if (!task) throw notFound("Task not found");

    let pointsAwarded = 0;
    let dayCompleted: CompleteTaskResult["day_completed"];
    let milestoneAchieved: CompleteTaskResult["milestone_achieved"];

    // ① task → done (idempotent: skip if already done).
    if (task.status !== "done") {
      await trx
        .updateTable("task")
        .set({ status: "done", completed_at: now, updated_at: now })
        .where("id", "=", taskId)
        .execute();
    }

    // ② today's plan item for this task → completed.
    const planItem = await trx
      .selectFrom("daily_plan_item as dpi")
      .innerJoin("daily_plan_day as d", "d.id", "dpi.daily_plan_day_id")
      .select(["dpi.id as item_id", "d.id as day_id"])
      .where("dpi.task_id", "=", taskId)
      .where("dpi.workspace_id", "=", ctx.workspaceId)
      .where("d.plan_date", "=", today)
      .executeTakeFirst();
    if (planItem) {
      await trx
        .updateTable("daily_plan_item")
        .set({ status: "completed", updated_at: now })
        .where("id", "=", planItem.item_id)
        .execute();
    }

    // ③ task_completed — once ever.
    pointsAwarded += await awardOnce(trx, {
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      eventType: "task_completed",
      source: { task_id: taskId },
      now,
    });

    // ④ work_package completion cache — set when no sibling task remains open.
    const openSibling = await trx
      .selectFrom("task")
      .select("id")
      .where("work_package_id", "=", task.work_package_id)
      .where("status", "<>", "done")
      .limit(1)
      .executeTakeFirst();

    if (!openSibling) {
      const wp = await trx
        .selectFrom("work_package")
        .select(["id", "milestone_id", "completed_at"])
        .where("id", "=", task.work_package_id)
        .executeTakeFirst();

      if (wp) {
        if (!wp.completed_at) {
          await trx
            .updateTable("work_package")
            .set({ completed_at: now, updated_at: now })
            .where("id", "=", wp.id)
            .execute();
        }

        // ⑤ milestone achievement — all WPs in the set complete.
        if (wp.milestone_id) {
          const openWp = await trx
            .selectFrom("work_package")
            .select("id")
            .where("milestone_id", "=", wp.milestone_id)
            .where("completed_at", "is", null)
            .limit(1)
            .executeTakeFirst();

          if (!openWp) {
            const ms = await trx
              .selectFrom("milestone")
              .select(["id", "title", "achieved_at"])
              .where("id", "=", wp.milestone_id)
              .executeTakeFirst();

            if (ms && !ms.achieved_at) {
              await trx
                .updateTable("milestone")
                .set({ achieved_at: now, updated_at: now })
                .where("id", "=", ms.id)
                .execute();
              const msPoints = await awardOnce(trx, {
                workspaceId: ctx.workspaceId,
                userId: ctx.userId,
                eventType: "milestone_achieved",
                source: { milestone_id: ms.id },
                now,
              });
              pointsAwarded += msPoints;
              milestoneAchieved = {
                milestone_id: ms.id,
                title: ms.title,
                points_awarded: msPoints,
              };
            }
          }
        }
      }
    }

    // ⑥ daily goal completion — the day's last planned item just completed.
    if (planItem) {
      const stillPlanned = await trx
        .selectFrom("daily_plan_item")
        .select("id")
        .where("daily_plan_day_id", "=", planItem.day_id)
        .where("status", "=", "planned")
        .limit(1)
        .executeTakeFirst();

      if (!stillPlanned) {
        const day = await trx
          .selectFrom("daily_plan_day")
          .select(["id", "plan_date", "status"])
          .where("id", "=", planItem.day_id)
          .executeTakeFirst();

        if (day && day.status !== "completed") {
          await trx
            .updateTable("daily_plan_day")
            .set({ status: "completed", completed_at: now, updated_at: now })
            .where("id", "=", day.id)
            .execute();
          const dgPoints = await awardOnce(trx, {
            workspaceId: ctx.workspaceId,
            userId: ctx.userId,
            eventType: "daily_goal_completed",
            source: { daily_plan_day_id: day.id },
            now,
          });
          pointsAwarded += dgPoints;
          dayCompleted = {
            daily_plan_day_id: day.id,
            plan_date: day.plan_date,
            points_awarded: dgPoints,
          };
        }
      }
    }

    // ⑦ engagement + stats (this endpoint is ⚡eng).
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

    const updated = await trx
      .selectFrom("task")
      .selectAll()
      .where("id", "=", taskId)
      .executeTakeFirstOrThrow();

    return {
      task: updated,
      points_awarded: pointsAwarded,
      day_completed: dayCompleted,
      milestone_achieved: milestoneAchieved,
    };
  });
}

/**
 * Un-complete a task. Clears status/completed_at and the work_package cache, and
 * returns today's plan item to `planned`. Points are NEVER revoked — the ledger
 * is append-only and each source scores once, ever (Principle 3). An already-
 * achieved milestone stays achieved; a completed day stays completed. Not built
 * as an endpoint in this slice, but implemented so the no-farm invariant is
 * testable (reopen → re-complete must award 0).
 */
export async function reopenTask(
  db: Kysely<Database>,
  ctx: AuthContext,
  taskId: string,
  now: Date = new Date(),
): Promise<Task> {
  const today = localDate(ctx.timezone, now);
  return withTransaction(db, async (trx) => {
    const task = await trx
      .selectFrom("task")
      .selectAll()
      .where("id", "=", taskId)
      .where("workspace_id", "=", ctx.workspaceId)
      .executeTakeFirst();
    if (!task) throw notFound("Task not found");

    if (task.status === "done") {
      await trx
        .updateTable("task")
        .set({ status: "todo", completed_at: null, updated_at: now })
        .where("id", "=", taskId)
        .execute();

      // Clear the work_package completion cache (source of truth is the tasks).
      await trx
        .updateTable("work_package")
        .set({ completed_at: null, updated_at: now })
        .where("id", "=", task.work_package_id)
        .where("completed_at", "is not", null)
        .execute();

      // Today's completed plan item returns to planned.
      const planItem = await trx
        .selectFrom("daily_plan_item as dpi")
        .innerJoin("daily_plan_day as d", "d.id", "dpi.daily_plan_day_id")
        .select("dpi.id as item_id")
        .where("dpi.task_id", "=", taskId)
        .where("dpi.workspace_id", "=", ctx.workspaceId)
        .where("d.plan_date", "=", today)
        .where("dpi.status", "=", "completed")
        .executeTakeFirst();
      if (planItem) {
        await trx
          .updateTable("daily_plan_item")
          .set({ status: "planned", updated_at: now })
          .where("id", "=", planItem.item_id)
          .execute();
      }
    }

    return trx
      .selectFrom("task")
      .selectAll()
      .where("id", "=", taskId)
      .executeTakeFirstOrThrow();
  });
}
