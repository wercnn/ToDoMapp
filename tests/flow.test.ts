/**
 * Project Flow Diagram tests (api §5, data-model §6). DB-backed status derivation
 * and critical-path computation, plus a pure unit test of the longest-path solver.
 *
 * Two cases earn their keep specifically:
 *  - the WP-dependency-driven critical path proves the work_package_dependency →
 *    task-edge m×n expansion is present AND correctly directed (removing the WP
 *    edge changes the winning path);
 *  - the timezone case proves in_progress uses midnight-LOCAL (invariant #3), not
 *    the server clock — it would report 'open' under a naive server-date impl.
 *
 * Requires DIRECT_URL + applied schema.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import { createDb } from "@/db/kysely";
import type { Database, DifficultyLevel } from "@/db/types";
import type { AuthContext } from "@/auth/context";
import { getProjectFlow, longestPath } from "@/domain/flow";
import {
  provisionWorkspace,
  teardownWorkspace,
  type ProvisionedWorkspace,
} from "@/testing/fixtures";
import { loadEnv } from "../scripts/env";

let db: Kysely<Database>;

beforeAll(() => {
  const env = loadEnv();
  if (!env.DIRECT_URL) {
    throw new Error("DIRECT_URL is required to run the flow tests (they hit Postgres).");
  }
  db = createDb(env.DIRECT_URL);
});

afterAll(async () => {
  if (db) await db.destroy();
});

// --- insert helpers (raw, so each test builds exactly the graph it needs) ---
async function mkGoal(ctx: AuthContext): Promise<string> {
  const r = await db
    .insertInto("goal")
    .values({ workspace_id: ctx.workspaceId, title: "G", horizon: "mid" })
    .returning("id")
    .executeTakeFirstOrThrow();
  return r.id;
}
async function mkProject(ctx: AuthContext, goalId: string): Promise<string> {
  const r = await db
    .insertInto("project")
    .values({ workspace_id: ctx.workspaceId, goal_id: goalId, title: "P", capacity_hours_per_day: 8 })
    .returning("id")
    .executeTakeFirstOrThrow();
  return r.id;
}
async function mkMilestone(
  ctx: AuthContext,
  projectId: string,
  opts: { position: number; achieved?: boolean } = { position: 0 },
): Promise<string> {
  const r = await db
    .insertInto("milestone")
    .values({
      workspace_id: ctx.workspaceId,
      project_id: projectId,
      title: `M${opts.position}`,
      position: opts.position,
      achieved_at: opts.achieved ? new Date() : null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return r.id;
}
async function mkWp(
  ctx: AuthContext,
  projectId: string,
  opts: { milestoneId?: string; position?: number; completed?: boolean } = {},
): Promise<string> {
  const r = await db
    .insertInto("work_package")
    .values({
      workspace_id: ctx.workspaceId,
      project_id: projectId,
      milestone_id: opts.milestoneId ?? null,
      title: "WP",
      estimate_hours: 1,
      position: opts.position ?? 0,
      completed_at: opts.completed ? new Date() : null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return r.id;
}
async function mkTask(
  ctx: AuthContext,
  wpId: string,
  opts: { hours?: number; difficulty?: DifficultyLevel; done?: boolean; position?: number } = {},
): Promise<string> {
  const r = await db
    .insertInto("task")
    .values({
      workspace_id: ctx.workspaceId,
      work_package_id: wpId,
      title: "T",
      estimate_hours: opts.difficulty ? null : (opts.hours ?? 1),
      difficulty: opts.difficulty ?? null,
      status: opts.done ? "done" : "todo",
      completed_at: opts.done ? new Date() : null,
      position: opts.position ?? 0,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return r.id;
}
async function mkWpDep(ctx: AuthContext, pred: string, succ: string): Promise<void> {
  await db
    .insertInto("work_package_dependency")
    .values({ workspace_id: ctx.workspaceId, predecessor_wp_id: pred, successor_wp_id: succ })
    .execute();
}
async function mkTaskDep(ctx: AuthContext, pred: string, succ: string): Promise<void> {
  await db
    .insertInto("task_dependency")
    .values({ workspace_id: ctx.workspaceId, predecessor_task_id: pred, successor_task_id: succ })
    .execute();
}
/** Put `taskId` on a planned day-step dated `planDate`. */
async function planOn(ctx: AuthContext, taskId: string, planDate: string): Promise<void> {
  const day = await db
    .insertInto("daily_plan_day")
    .values({ workspace_id: ctx.workspaceId, plan_date: planDate, status: "proposed" })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db
    .insertInto("daily_plan_item")
    .values({
      workspace_id: ctx.workspaceId,
      daily_plan_day_id: day.id,
      item_type: "task",
      task_id: taskId,
      status: "planned",
      origin: "proposed",
      position: 0,
    })
    .execute();
}

describe("longestPath (pure)", () => {
  it("picks the heavier of two paths ending in the end set", () => {
    // a→b→d (1+5+1=7) vs a→c→d (1+1+1=3); end set {d}. Heavier wins.
    const nodes = [
      { id: "a", weight: 1 },
      { id: "b", weight: 5 },
      { id: "c", weight: 1 },
      { id: "d", weight: 1 },
    ];
    const edges: [string, string][] = [
      ["a", "b"],
      ["b", "d"],
      ["a", "c"],
      ["c", "d"],
    ];
    expect(longestPath(nodes, edges, new Set(["d"]))).toEqual(["a", "b", "d"]);
  });

  it("returns [] when no node in the end set is reachable", () => {
    const nodes = [{ id: "a", weight: 1 }];
    expect(longestPath(nodes, [], new Set(["z"]))).toEqual([]);
  });
});

describe("project flow (DB-backed)", () => {
  let ws: ProvisionedWorkspace;

  afterEach(async () => {
    if (ws) await teardownWorkspace(db, ws);
  });

  it("derives node status at both levels (done / blocked / in_progress / open)", async () => {
    ws = await provisionWorkspace(db, { timezone: "UTC" });
    const ctx = ws.ctx;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(new Date());
    const goal = await mkGoal(ctx);
    const project = await mkProject(ctx, goal);

    // done: completed WP with a done task.
    const wpDone = await mkWp(ctx, project, { position: 0, completed: true });
    const tDone = await mkTask(ctx, wpDone, { done: true });

    // blocked: WPa (open) → WPb; tb blocked by the upstream WP, WPb blocked.
    const wpA = await mkWp(ctx, project, { position: 1 });
    const tA = await mkTask(ctx, wpA);
    const wpB = await mkWp(ctx, project, { position: 2 });
    const tB = await mkTask(ctx, wpB);
    await mkWpDep(ctx, wpA, wpB);

    // in_progress: WPc with a task planned today.
    const wpC = await mkWp(ctx, project, { position: 3 });
    const tC = await mkTask(ctx, wpC);
    await planOn(ctx, tC, today);

    // open: WPd with an idle task.
    const wpD = await mkWp(ctx, project, { position: 4 });
    const tD = await mkTask(ctx, wpD);

    const flow = await getProjectFlow(db, ctx, project);
    const status = new Map(flow.nodes.map((n) => [n.id, n.derived_status]));

    expect(status.get(wpDone)).toBe("done");
    expect(status.get(tDone)).toBe("done");
    expect(status.get(wpA)).toBe("open");
    expect(status.get(tA)).toBe("open");
    expect(status.get(wpB)).toBe("blocked");
    expect(status.get(tB)).toBe("blocked");
    expect(status.get(wpC)).toBe("in_progress");
    expect(status.get(tC)).toBe("in_progress");
    expect(status.get(wpD)).toBe("open");
    expect(status.get(tD)).toBe("open");
  });

  it("selects the first unachieved milestone by position as next_milestone", async () => {
    ws = await provisionWorkspace(db, { timezone: "UTC" });
    const ctx = ws.ctx;
    const goal = await mkGoal(ctx);
    const project = await mkProject(ctx, goal);
    await mkMilestone(ctx, project, { position: 0, achieved: true });
    const m2 = await mkMilestone(ctx, project, { position: 1 });
    await mkMilestone(ctx, project, { position: 2 });

    const flow = await getProjectFlow(db, ctx, project);
    expect(flow.next_milestone?.id).toBe(m2);
  });

  it("critical path is decided by a work_package_dependency (expansion present & directed)", async () => {
    ws = await provisionWorkspace(db, { timezone: "UTC" });
    const ctx = ws.ctx;
    const goal = await mkGoal(ctx);
    const project = await mkProject(ctx, goal);
    const milestone = await mkMilestone(ctx, project, { position: 0 });

    // Two upstream WPs feed the milestone WP; only the WP edges connect them
    // (there are NO task-level edges), so the path can only exist via expansion.
    const wpLong = await mkWp(ctx, project, { position: 0 });
    const tLong = await mkTask(ctx, wpLong, { hours: 5 });
    const wpShort = await mkWp(ctx, project, { position: 1 });
    const tShort = await mkTask(ctx, wpShort, { hours: 1 });
    const wpEnd = await mkWp(ctx, project, { position: 2, milestoneId: milestone });
    const tEnd = await mkTask(ctx, wpEnd, { hours: 1 });

    await mkWpDep(ctx, wpLong, wpEnd);
    await mkWpDep(ctx, wpShort, wpEnd);

    // Heavier predecessor wins; direction proven (end node has incoming, not outgoing).
    const flow1 = await getProjectFlow(db, ctx, project);
    expect(flow1.critical_path).toEqual([tLong, tEnd]);

    // Remove the deciding WP edge → a different (shorter-predecessor) path wins.
    await db
      .deleteFrom("work_package_dependency")
      .where("workspace_id", "=", ctx.workspaceId)
      .where("predecessor_wp_id", "=", wpLong)
      .where("successor_wp_id", "=", wpEnd)
      .execute();
    const flow2 = await getProjectFlow(db, ctx, project);
    expect(flow2.critical_path).toEqual([tShort, tEnd]);
  });

  it("marks a task in_progress by LOCAL today, not the server clock (invariant #3)", async () => {
    // UTC 20:00 on the 13th is already the 14th in Tokyo (UTC+9).
    const now = new Date("2026-06-13T20:00:00Z");
    const localToday = "2026-06-14"; // Asia/Tokyo
    const serverDate = "2026-06-13"; // what a naive impl would use
    expect(localToday).not.toBe(serverDate);

    ws = await provisionWorkspace(db, { timezone: "Asia/Tokyo" });
    const ctx = ws.ctx;
    const goal = await mkGoal(ctx);
    const project = await mkProject(ctx, goal);
    const wp = await mkWp(ctx, project, { position: 0 });
    const task = await mkTask(ctx, wp);
    await planOn(ctx, task, localToday); // planned on the LOCAL today

    const flow = await getProjectFlow(db, ctx, project, now);
    const status = new Map(flow.nodes.map((n) => [n.id, n.derived_status]));
    // Found only if "today" is resolved in Asia/Tokyo; a server-date impl → 'open'.
    expect(status.get(task)).toBe("in_progress");
    expect(status.get(wp)).toBe("in_progress");
  });
});
