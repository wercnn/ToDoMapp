/**
 * Completion-cascade tests (test-first for the one place a silent bug hides).
 * These run against the REAL database so they exercise the partial unique indexes
 * that are the double-award guard (data-model §4.6, invariant #8).
 *
 * Requires DIRECT_URL and an applied schema (`npm run migrate`). If DIRECT_URL is
 * absent the suite fails loudly rather than silently passing — the whole point is
 * to verify against Postgres.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import { createDb } from "@/db/kysely";
import type { Database } from "@/db/types";
import type { AuthContext } from "@/auth/context";
import { localDate } from "@/lib/dates";
import { completeTask, reopenTask } from "@/domain/completion";
import {
  provisionWorkspace,
  seedScenario,
  teardownWorkspace,
  type Scenario,
} from "@/testing/fixtures";
import { loadEnv } from "../scripts/env";

// Point values seeded by migration 20260613000002 (placeholders, tunable).
const PTS_TASK = 10;
const PTS_DAILY = 50;
const PTS_MILESTONE = 100;

let db: Kysely<Database>;

beforeAll(() => {
  const env = loadEnv();
  if (!env.DIRECT_URL) {
    throw new Error(
      "DIRECT_URL is required to run the completion-cascade tests (they hit Postgres). See .env.example.",
    );
  }
  db = createDb(env.DIRECT_URL);
});

afterAll(async () => {
  if (db) await db.destroy();
});

describe("task-completion cascade", () => {
  let ws: { ctx: AuthContext; userId: string; workspaceId: string };
  let scenario: Scenario;
  let now: Date;
  let today: string;

  beforeEach(async () => {
    ws = await provisionWorkspace(db, { timezone: "UTC" });
    now = new Date();
    today = localDate("UTC", now);
    scenario = await seedScenario(db, ws.ctx, { planDate: today });
  });

  afterEach(async () => {
    await teardownWorkspace(db, ws);
  });

  async function pointEventCount(filter: Partial<{ task_id: string; daily_plan_day_id: string; milestone_id: string }>) {
    let q = db.selectFrom("point_event").select((eb) => eb.fn.countAll<number>().as("c")).where("workspace_id", "=", ws.workspaceId);
    if (filter.task_id) q = q.where("task_id", "=", filter.task_id);
    if (filter.daily_plan_day_id) q = q.where("daily_plan_day_id", "=", filter.daily_plan_day_id);
    if (filter.milestone_id) q = q.where("milestone_id", "=", filter.milestone_id);
    const row = await q.executeTakeFirstOrThrow();
    return Number(row.c);
  }

  async function totalPoints() {
    const row = await db
      .selectFrom("user_stats")
      .select("total_points")
      .where("user_id", "=", ws.userId)
      .executeTakeFirstOrThrow();
    return row.total_points;
  }

  it("completing a task awards task points once, records engagement, updates stats", async () => {
    const res = await completeTask(db, ws.ctx, scenario.t1Id, now);

    expect(res.task.status).toBe("done");
    expect(res.task.completed_at).not.toBeNull();
    expect(res.points_awarded).toBe(PTS_TASK);
    expect(res.milestone_achieved).toBeUndefined(); // WP2 still open
    expect(res.day_completed).toBeUndefined(); // T2 still planned

    expect(await pointEventCount({ task_id: scenario.t1Id })).toBe(1);
    expect(await totalPoints()).toBe(PTS_TASK);

    // WP1 cache set (its only task done); WP2 still open.
    const wp1 = await db.selectFrom("work_package").select("completed_at").where("id", "=", scenario.wp1Id).executeTakeFirstOrThrow();
    expect(wp1.completed_at).not.toBeNull();

    // Today's plan item mirrored to completed.
    const item = await db.selectFrom("daily_plan_item").select("status").where("id", "=", scenario.item1Id).executeTakeFirstOrThrow();
    expect(item.status).toBe("completed");

    // Engagement recorded → streak of 1.
    const stats = await db.selectFrom("user_stats").selectAll().where("user_id", "=", ws.userId).executeTakeFirstOrThrow();
    expect(stats.current_streak).toBe(1);
    expect(stats.last_engaged_date).toBe(today);
  });

  it("completing the final WP achieves the milestone and completes the daily goal, each scored once", async () => {
    await completeTask(db, ws.ctx, scenario.t1Id, now);
    const res = await completeTask(db, ws.ctx, scenario.t2Id, now);

    // T2 award = task + milestone (both WPs now done) + daily goal (last item).
    expect(res.milestone_achieved).toMatchObject({ milestone_id: scenario.milestoneId, points_awarded: PTS_MILESTONE });
    expect(res.day_completed).toMatchObject({ daily_plan_day_id: scenario.dayId, points_awarded: PTS_DAILY });
    expect(res.points_awarded).toBe(PTS_TASK + PTS_MILESTONE + PTS_DAILY);

    // Ledger: 2 task events, 1 milestone, 1 daily goal.
    expect(await pointEventCount({ task_id: scenario.t1Id })).toBe(1);
    expect(await pointEventCount({ task_id: scenario.t2Id })).toBe(1);
    expect(await pointEventCount({ milestone_id: scenario.milestoneId })).toBe(1);
    expect(await pointEventCount({ daily_plan_day_id: scenario.dayId })).toBe(1);

    expect(await totalPoints()).toBe(2 * PTS_TASK + PTS_MILESTONE + PTS_DAILY);

    const ms = await db.selectFrom("milestone").select("achieved_at").where("id", "=", scenario.milestoneId).executeTakeFirstOrThrow();
    expect(ms.achieved_at).not.toBeNull();
    const day = await db.selectFrom("daily_plan_day").select(["status", "completed_at"]).where("id", "=", scenario.dayId).executeTakeFirstOrThrow();
    expect(day.status).toBe("completed");
    expect(day.completed_at).not.toBeNull();
  });

  it("reopening then re-completing a task NEVER farms points (idempotent scoring)", async () => {
    await completeTask(db, ws.ctx, scenario.t1Id, now);
    await completeTask(db, ws.ctx, scenario.t2Id, now);
    const baseline = await totalPoints();
    expect(baseline).toBe(2 * PTS_TASK + PTS_MILESTONE + PTS_DAILY);

    // Reopen T2 — points are never revoked, milestone stays achieved.
    const reopened = await reopenTask(db, ws.ctx, scenario.t2Id, now);
    expect(reopened.status).toBe("todo");
    expect(await totalPoints()).toBe(baseline);
    const msAfterReopen = await db.selectFrom("milestone").select("achieved_at").where("id", "=", scenario.milestoneId).executeTakeFirstOrThrow();
    expect(msAfterReopen.achieved_at).not.toBeNull();

    // Re-complete T2 — must award nothing new, anywhere.
    const res = await completeTask(db, ws.ctx, scenario.t2Id, now);
    expect(res.points_awarded).toBe(0);
    expect(res.milestone_achieved).toBeUndefined();
    expect(res.day_completed).toBeUndefined();

    expect(await pointEventCount({ task_id: scenario.t2Id })).toBe(1);
    expect(await pointEventCount({ milestone_id: scenario.milestoneId })).toBe(1);
    expect(await pointEventCount({ daily_plan_day_id: scenario.dayId })).toBe(1);
    expect(await totalPoints()).toBe(baseline);
  });

  it("re-completing an already-done task is a no-op for scoring", async () => {
    const first = await completeTask(db, ws.ctx, scenario.t1Id, now);
    expect(first.points_awarded).toBe(PTS_TASK);
    const second = await completeTask(db, ws.ctx, scenario.t1Id, now);
    expect(second.points_awarded).toBe(0);
    expect(await pointEventCount({ task_id: scenario.t1Id })).toBe(1);
  });

  it("the DB partial-unique index is the backstop: a duplicate point_event is rejected", async () => {
    await completeTask(db, ws.ctx, scenario.t1Id, now);
    // Attempt to insert a second task_completed event for the same task directly.
    await expect(
      db
        .insertInto("point_event")
        .values({
          workspace_id: ws.workspaceId,
          user_id: ws.userId,
          event_type: "task_completed",
          points: PTS_TASK,
          task_id: scenario.t1Id,
          daily_plan_day_id: null,
          milestone_id: null,
        })
        .execute(),
    ).rejects.toMatchObject({ code: "23505" }); // unique_violation
  });
});
