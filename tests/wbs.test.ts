/**
 * WBS edits/deletes + roll-ups (Phase 8). DB-backed — exercises the FK cascade
 * chain and the SET NULL behaviors that the app deliberately RELIES on rather than
 * reimplementing. Covers: PATCH/DELETE happy paths + cross-workspace 404; the
 * milestone-DELETE-ungroups (WPs survive, milestone_id nulled); goal cascade-delete
 * leaves the point ledger intact (sources SET NULL); progress roll-up correctness;
 * and the two "not via PATCH" guards (milestone achieved_at, task status).
 *
 * Requires DIRECT_URL + an applied schema (`npm run migrate`).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import { createDb } from "@/db/kysely";
import type { Database } from "@/db/types";
import type { AuthContext } from "@/auth/context";
import { localDate } from "@/lib/dates";
import { completeTask } from "@/domain/completion";
import { getGoal, updateGoal, deleteGoal } from "@/domain/goals";
import { getProject, listProjects, updateProject, deleteProject } from "@/domain/projects";
import { getWorkPackage, updateWorkPackage, deleteWorkPackage } from "@/domain/workPackages";
import { getTask, updateTask, deleteTask } from "@/domain/tasks";
import {
  listMilestones,
  createMilestone,
  updateMilestone,
  deleteMilestone,
} from "@/domain/milestones";
import {
  computeGoalProgress,
  computeProjectProgress,
  computeProjectProgressBatch,
} from "@/domain/progress";
import {
  provisionWorkspace,
  seedScenario,
  teardownWorkspace,
  type Scenario,
} from "@/testing/fixtures";
import { loadEnv } from "../scripts/env";

let db: Kysely<Database>;

beforeAll(() => {
  const env = loadEnv();
  if (!env.DIRECT_URL) {
    throw new Error("DIRECT_URL is required to run the WBS tests (they hit Postgres).");
  }
  db = createDb(env.DIRECT_URL);
});

afterAll(async () => {
  if (db) await db.destroy();
});

describe("Phase 8 — WBS edits/deletes + roll-ups", () => {
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

  // --- GET-one reads ---------------------------------------------------------
  it("GET-ones return the row with derived extras (goal/project progress, wp tasks, task blocked)", async () => {
    const goal = await getGoal(db, ws.ctx, scenario.goalId, { includeProgress: true });
    expect("progress" in goal).toBe(true);

    const project = await getProject(db, ws.ctx, scenario.projectId, { includeProgress: true });
    expect("progress" in project).toBe(true);

    const projects = await listProjects(db, ws.ctx, scenario.goalId, { includeProgress: true });
    expect(projects).toHaveLength(1);
    expect("progress" in projects[0]!).toBe(true);

    const wp = await getWorkPackage(db, ws.ctx, scenario.wp1Id, { includeTasks: true });
    expect("tasks" in wp && (wp as { tasks: unknown[] }).tasks.length).toBe(1);

    const task = await getTask(db, ws.ctx, scenario.t1Id);
    expect(task.blocked).toBe(false);
  });

  // --- PATCH happy paths -----------------------------------------------------
  it("PATCH edits goal/project/wp/task/milestone fields", async () => {
    const goal = await updateGoal(db, ws.ctx, scenario.goalId, { title: "Renamed Goal", horizon: "long" });
    expect(goal.title).toBe("Renamed Goal");
    expect(goal.horizon).toBe("long");

    const project = await updateProject(db, ws.ctx, scenario.projectId, { capacity_hours_per_day: 6 });
    expect(Number(project.capacity_hours_per_day)).toBe(6);

    const wp = await updateWorkPackage(db, ws.ctx, scenario.wp1Id, { title: "WP renamed" });
    expect(wp.title).toBe("WP renamed");

    const task = await updateTask(db, ws.ctx, scenario.t1Id, { title: "Task renamed", notes: "n" });
    expect(task.title).toBe("Task renamed");

    const ms = await updateMilestone(db, ws.ctx, scenario.milestoneId, { title: "MS renamed" });
    expect(ms.title).toBe("MS renamed");
  });

  it("PATCH goal status→achieved stamps achieved_at; project status→completed stamps completed_at", async () => {
    const goal = await updateGoal(db, ws.ctx, scenario.goalId, { status: "achieved" });
    expect(goal.status).toBe("achieved");
    expect(goal.achieved_at).not.toBeNull();

    const project = await updateProject(db, ws.ctx, scenario.projectId, { status: "completed" });
    expect(project.completed_at).not.toBeNull();
  });

  it("task PATCH refuses status/completed_at (422 — use complete/reopen)", async () => {
    await expect(
      updateTask(db, ws.ctx, scenario.t1Id, { status: "done" } as never),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("milestone PATCH cannot set achieved_at (silently ignored — never writable)", async () => {
    const ms = await updateMilestone(db, ws.ctx, scenario.milestoneId, {
      title: "x",
      achieved_at: new Date(),
    } as never);
    expect(ms.achieved_at).toBeNull();
  });

  // --- cross-workspace tenancy = 404 ----------------------------------------
  it("cross-workspace edits/reads are 404 (tenancy hidden)", async () => {
    const other = await provisionWorkspace(db, { timezone: "UTC" });
    try {
      await expect(getGoal(db, other.ctx, scenario.goalId)).rejects.toMatchObject({ status: 404 });
      await expect(
        updateProject(db, other.ctx, scenario.projectId, { title: "x" }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(deleteWorkPackage(db, other.ctx, scenario.wp1Id)).rejects.toMatchObject({ status: 404 });
      await expect(getTask(db, other.ctx, scenario.t1Id)).rejects.toMatchObject({ status: 404 });
      await expect(
        updateMilestone(db, other.ctx, scenario.milestoneId, { title: "x" }),
      ).rejects.toMatchObject({ status: 404 });
    } finally {
      await teardownWorkspace(db, other);
    }
  });

  // --- milestone CRUD + ungroup-on-delete -----------------------------------
  it("milestone create/list reflect WP membership + projected dates", async () => {
    const created = await createMilestone(db, ws.ctx, scenario.projectId, { title: "M2" });
    expect(created.achieved_at).toBeNull();

    const list = await listMilestones(db, ws.ctx, scenario.projectId, now);
    const seeded = list.find((m) => m.id === scenario.milestoneId)!;
    expect(seeded.wp_total).toBe(2); // WP1 + WP2 are in the seed milestone
    expect(seeded.wp_done).toBe(0);
    expect(seeded.achieved).toBe(false);
  });

  it("DELETE milestone UNGROUPS its work packages (SET NULL) — WPs survive", async () => {
    await deleteMilestone(db, ws.ctx, scenario.milestoneId);

    // Milestone gone, but both work packages still exist with milestone_id nulled.
    const ms = await db
      .selectFrom("milestone")
      .select("id")
      .where("id", "=", scenario.milestoneId)
      .executeTakeFirst();
    expect(ms).toBeUndefined();

    const wps = await db
      .selectFrom("work_package")
      .select(["id", "milestone_id"])
      .where("project_id", "=", scenario.projectId)
      .execute();
    expect(wps.map((w) => w.id).sort()).toEqual([scenario.wp1Id, scenario.wp2Id].sort());
    expect(wps.every((w) => w.milestone_id === null)).toBe(true);
  });

  // --- subtree cascade-delete keeps the point ledger ------------------------
  it("DELETE goal cascades the subtree but the point ledger survives (SET NULL sources)", async () => {
    // Complete a task so there's a scored point_event referencing it.
    await completeTask(db, ws.ctx, scenario.t1Id, now);
    const before = await db
      .selectFrom("point_event")
      .select((eb) => eb.fn.countAll<number>().as("c"))
      .where("workspace_id", "=", ws.workspaceId)
      .executeTakeFirstOrThrow();
    expect(Number(before.c)).toBeGreaterThan(0);

    await deleteGoal(db, ws.ctx, scenario.goalId);

    // Subtree gone.
    const projects = await db
      .selectFrom("project")
      .select("id")
      .where("goal_id", "=", scenario.goalId)
      .execute();
    expect(projects).toHaveLength(0);
    const tasks = await db
      .selectFrom("task")
      .select("id")
      .where("id", "in", [scenario.t1Id, scenario.t2Id])
      .execute();
    expect(tasks).toHaveLength(0);

    // Ledger preserved — rows survive with task_id nulled (append-only history).
    const after = await db
      .selectFrom("point_event")
      .select(["id", "task_id"])
      .where("workspace_id", "=", ws.workspaceId)
      .execute();
    expect(after.length).toBe(Number(before.c));
    expect(after.every((e) => e.task_id === null)).toBe(true);
  });

  it("DELETE happy paths return cleanly and 404 on re-delete", async () => {
    await deleteTask(db, ws.ctx, scenario.t2Id);
    await expect(deleteTask(db, ws.ctx, scenario.t2Id)).rejects.toMatchObject({ status: 404 });
    await deleteProject(db, ws.ctx, scenario.projectId);
    await expect(getProject(db, ws.ctx, scenario.projectId)).rejects.toMatchObject({ status: 404 });
  });

  // --- progress roll-up correctness -----------------------------------------
  it("progress roll-up: known WBS (2 tasks, 2h each) → 50% after one done; goal == project", async () => {
    // Initial: nothing done.
    let pp = await computeProjectProgress(db, ws.ctx, scenario.projectId);
    expect(pp).toMatchObject({
      percent_done: 0,
      tasks_done: 0,
      tasks_total: 2,
      estimate_done_hours: 0,
      estimate_total_hours: 4,
    });

    // Complete one of the two equal tasks.
    await completeTask(db, ws.ctx, scenario.t1Id, now);
    pp = await computeProjectProgress(db, ws.ctx, scenario.projectId);
    expect(pp).toMatchObject({
      percent_done: 50,
      tasks_done: 1,
      tasks_total: 2,
      estimate_done_hours: 2,
      estimate_total_hours: 4,
    });

    // Single project under the goal → goal roll-up equals project roll-up.
    const gp = await computeGoalProgress(db, ws.ctx, scenario.goalId);
    expect(gp).toEqual(pp);
  });

  // --- batched progress (Track 3: kills the listProjects N+1) ----------------
  it("batched progress matches the per-project path for every project, incl. empties", async () => {
    // Scenario already has projectId (2 tasks). Add a second EMPTY project (no
    // tasks → percent on empty set) and a third with one done task, all under the
    // same goal — the exact mix the Sidebar reads via listProjects?include=progress.
    const empty = await db
      .insertInto("project")
      .values({
        workspace_id: ws.workspaceId,
        goal_id: scenario.goalId,
        title: "Empty Project",
        capacity_hours_per_day: 4,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    const third = await db
      .insertInto("project")
      .values({
        workspace_id: ws.workspaceId,
        goal_id: scenario.goalId,
        title: "Third Project",
        capacity_hours_per_day: 4,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const wp3 = await db
      .insertInto("work_package")
      .values({ workspace_id: ws.workspaceId, project_id: third.id, title: "WP3", position: 0 })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("task")
      .values({
        workspace_id: ws.workspaceId,
        work_package_id: wp3.id,
        title: "T3 done",
        difficulty: "mid",
        status: "done",
        completed_at: now,
        position: 0,
      })
      .executeTakeFirstOrThrow();

    const ids = [scenario.projectId, empty.id, third.id];
    const batch = await computeProjectProgressBatch(db, ws.ctx, ids);

    // PARITY: batch == the single-project path it replaces, project by project.
    for (const id of ids) {
      const single = await computeProjectProgress(db, ws.ctx, id);
      expect(batch.get(id)).toEqual(single);
    }

    // Empty project: percent on an empty set is 0, not NaN, and zero everywhere.
    expect(batch.get(empty.id)).toMatchObject({
      percent_done: 0,
      tasks_done: 0,
      tasks_total: 0,
      estimate_done_hours: 0,
      estimate_total_hours: 0,
    });

    // Empty input list → empty map (the empty-goal case; no `IN ()` blow-up).
    expect((await computeProjectProgressBatch(db, ws.ctx, [])).size).toBe(0);

    // listProjects?include=progress (the real Sidebar call) carries the batch result.
    const withProgress = await listProjects(db, ws.ctx, scenario.goalId, { includeProgress: true });
    expect(withProgress).toHaveLength(3);
    for (const p of withProgress) {
      expect("progress" in p).toBe(true);
      expect((p as { progress: unknown }).progress).toEqual(batch.get(p.id));
    }
  });

  it("empty goal (no projects) → listProjects returns [] with includeProgress", async () => {
    const lone = await db
      .insertInto("goal")
      .values({ workspace_id: ws.workspaceId, title: "Lonely Goal", horizon: "short" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const projects = await listProjects(db, ws.ctx, lone.id, { includeProgress: true });
    expect(projects).toEqual([]);
  });
});
