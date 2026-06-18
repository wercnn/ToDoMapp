/**
 * Phase 6 — Roadmap projection & daily-planning reads (api §10, data-model §6).
 *
 * The cases that earn their keep:
 *  - PLANNER 2A safety: empty `edges` is byte-identical to omitting them (proves
 *    /propose is unaffected) AND a CROSS-PROJECT A→B dependency proves edge-awareness
 *    was necessary — position-ordering alone (the 2B approach) would have placed B
 *    alongside A and been wrong.
 *  - projection: staged unblocking places B after A; milestone projected_date = max
 *    gating-task date; time-fixed pinned; non-UTC timezone.
 *  - invariant #5: GET /roadmap / projectSchedule write NOTHING.
 *  - the payoff: a dependency-gated milestone gets a real projected_date (null before).
 *  - unification: the projected_date a replan shows for a milestone EQUALS what
 *    /roadmap shows for it (same shared helper).
 *  - the edit endpoints: add (blocked/dup/planned-elsewhere), defer/reorder, delete,
 *    pull-forward (blocked/already-there), getDay (today ⚡eng / 404).
 *
 * Requires DIRECT_URL + applied schema.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import { createDb } from "@/db/kysely";
import type { Database } from "@/db/types";
import { planner } from "@/planner/index";
import { projectSchedule } from "@/domain/projection";
import { getRoadmap, getDay } from "@/domain/roadmapRead";
import { addItem, patchItem, deleteItem, pullForward } from "@/domain/planItems";
import { getProjectFlow } from "@/domain/flow";
import { analyzeReplan } from "@/domain/replan/analyze";
import { mapDbError } from "@/lib/errors";
import { addDays, localDate } from "@/lib/dates";
import {
  provisionWorkspace,
  teardownWorkspace,
  type ProvisionedWorkspace,
} from "@/testing/fixtures";
import { loadEnv } from "../scripts/env";

let db: Kysely<Database>;
const provisioned: ProvisionedWorkspace[] = [];

beforeAll(() => {
  const env = loadEnv();
  if (!env.DIRECT_URL) {
    throw new Error("DIRECT_URL is required to run the roadmap tests (they hit Postgres).");
  }
  db = createDb(env.DIRECT_URL);
});

afterAll(async () => {
  if (db) await db.destroy();
});

afterEach(async () => {
  for (const p of provisioned.splice(0)) {
    await teardownWorkspace(db, { workspaceId: p.workspaceId, userId: p.userId });
  }
});

async function provision(opts: { timezone?: string } = {}): Promise<ProvisionedWorkspace> {
  const p = await provisionWorkspace(db, opts);
  provisioned.push(p);
  return p;
}

/** Domain surfaces DB-constraint violations as raw pg errors; the HTTP layer maps
 *  them. Assert the mapping the route would produce. */
async function expectMappedStatus(status: number, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    expect(mapDbError(err)?.status).toBe(status);
    return;
  }
  throw new Error(`expected a DB error mapped to ${status}, but nothing was thrown`);
}

// ---- DB seeding helpers ----------------------------------------------------
async function addGoalProject(ws: string, capacity: number): Promise<{ goalId: string; projectId: string }> {
  const goal = await db
    .insertInto("goal").values({ workspace_id: ws, title: "G", horizon: "mid" })
    .returning("id").executeTakeFirstOrThrow();
  const project = await db
    .insertInto("project")
    .values({ workspace_id: ws, goal_id: goal.id, title: "P", capacity_hours_per_day: capacity })
    .returning("id").executeTakeFirstOrThrow();
  return { goalId: goal.id, projectId: project.id };
}
async function addMilestone(ws: string, projectId: string, position: number): Promise<string> {
  const m = await db
    .insertInto("milestone")
    .values({ workspace_id: ws, project_id: projectId, title: "M", position })
    .returning("id").executeTakeFirstOrThrow();
  return m.id;
}
async function addWp(ws: string, projectId: string, milestoneId: string | null, position: number): Promise<string> {
  const wp = await db
    .insertInto("work_package")
    .values({ workspace_id: ws, project_id: projectId, milestone_id: milestoneId, title: "WP", position })
    .returning("id").executeTakeFirstOrThrow();
  return wp.id;
}
async function addTask(
  ws: string,
  wpId: string,
  opts: { estimate?: number; position?: number; timeFixed?: boolean; fixedDate?: string } = {},
): Promise<string> {
  const t = await db
    .insertInto("task")
    .values({
      workspace_id: ws, work_package_id: wpId, title: "T",
      estimate_hours: opts.estimate ?? 2, position: opts.position ?? 0,
      is_time_fixed: opts.timeFixed ?? false, fixed_date: opts.fixedDate ?? null,
    })
    .returning("id").executeTakeFirstOrThrow();
  return t.id;
}
async function addTaskDep(ws: string, pred: string, succ: string): Promise<void> {
  await db.insertInto("task_dependency")
    .values({ workspace_id: ws, predecessor_task_id: pred, successor_task_id: succ }).execute();
}
async function rowCounts(ws: string): Promise<{ days: number; items: number }> {
  const d = await db.selectFrom("daily_plan_day").select((e) => e.fn.countAll<string>().as("c"))
    .where("workspace_id", "=", ws).executeTakeFirstOrThrow();
  const i = await db.selectFrom("daily_plan_item").select((e) => e.fn.countAll<string>().as("c"))
    .where("workspace_id", "=", ws).executeTakeFirstOrThrow();
  return { days: Number(d.c), items: Number(i.c) };
}

// ---- Pure planner (2A) tests ----------------------------------------------
describe("planner staged unblocking (2A)", () => {
  const base = {
    startDate: "2026-06-14",
    horizonDays: 5,
    candidates: [
      { taskId: "A", projectId: "X", hours: 2, isTimeFixed: false, fixedDate: null, blocked: false, position: 0 },
      { taskId: "B", projectId: "Y", hours: 2, isTimeFixed: false, fixedDate: null, blocked: false, position: 0 },
    ],
    capacities: [
      { projectId: "X", hoursPerDay: 8 },
      { projectId: "Y", hoursPerDay: 8 },
    ],
  };

  it("empty edges is identical to omitting edges (the /propose safety guarantee)", () => {
    const without = planner.proposeDays(base);
    const withEmpty = planner.proposeDays({ ...base, edges: [] });
    expect(withEmpty).toEqual(without);
    // And both place A and B on the SAME first day (no staging) — separate projects.
    expect(without).toHaveLength(1);
    expect(without[0]!.planDate).toBe("2026-06-14");
    expect(without[0]!.items.map((i) => i.taskId).sort()).toEqual(["A", "B"]);
  });

  it("a cross-project A→B edge pushes B to a later day (edge-awareness was necessary)", () => {
    const staged = planner.proposeDays({
      ...base,
      edges: [{ predecessorTaskId: "A", successorTaskId: "B" }],
    });
    const dateOf = (id: string) => staged.find((d) => d.items.some((i) => i.taskId === id))!.planDate;
    expect(dateOf("A")).toBe("2026-06-14");
    expect(dateOf("B")).toBe("2026-06-15"); // strictly after A — position-order alone wouldn't do this
  });
});

// ---- Projection tests ------------------------------------------------------
describe("roadmap projection", () => {
  it("stages B after A, derives milestone projected_date, pins time-fixed, and writes nothing", async () => {
    const { ctx, workspaceId } = await provision({ timezone: "UTC" });
    const now = new Date("2026-06-14T12:00:00Z");
    const today = localDate("UTC", now);
    const { projectId } = await addGoalProject(workspaceId, 8);
    const ms = await addMilestone(workspaceId, projectId, 0);
    const wpA = await addWp(workspaceId, projectId, ms, 0);
    const wpB = await addWp(workspaceId, projectId, ms, 1);
    const a = await addTask(workspaceId, wpA, { estimate: 2, position: 0 });
    const b = await addTask(workspaceId, wpB, { estimate: 2, position: 1 });
    await addTaskDep(workspaceId, a, b); // A must finish before B

    const before = await rowCounts(workspaceId);
    const { taskDate, milestoneDate } = await projectSchedule(db, ctx, { now });
    const after = await rowCounts(workspaceId);

    expect(after).toEqual(before); // invariant #5: projection writes nothing
    expect(taskDate.get(a)).toBe(today);
    expect(taskDate.get(b)!).toBe(addDays(today, 1)); // staged after A
    expect(milestoneDate.get(ms)).toBe(addDays(today, 1)); // max gating-task date = B's

    // A time-fixed task is pinned to its date.
    const wpC = await addWp(workspaceId, projectId, null, 2);
    const fixed = addDays(today, 3);
    const c = await addTask(workspaceId, wpC, { estimate: 2, timeFixed: true, fixedDate: fixed });
    const second = await projectSchedule(db, ctx, { now });
    expect(second.taskDate.get(c)).toBe(fixed);
  });

  it("milestone projected_date is null (but the milestone still appears) when a gating task can't be placed", async () => {
    const { ctx, workspaceId } = await provision({ timezone: "UTC" });
    const now = new Date("2026-06-14T12:00:00Z");
    const today = localDate("UTC", now);
    const { projectId } = await addGoalProject(workspaceId, 8);
    const ms = await addMilestone(workspaceId, projectId, 0);
    const wp = await addWp(workspaceId, projectId, ms, 0);
    // A time-fixed task pinned beyond the (small) horizon can't land → unknowable.
    await addTask(workspaceId, wp, { estimate: 2, timeFixed: true, fixedDate: addDays(today, 30) });

    const { milestoneDate } = await projectSchedule(db, ctx, { now, horizonDays: 5 });
    expect(milestoneDate.has(ms)).toBe(true); // present, NOT omitted
    expect(milestoneDate.get(ms)).toBeNull(); // with an explicit "can't schedule" null
  });

  it("re-projects work from a SLIPPED day forward instead of letting it vanish", async () => {
    const { ctx, workspaceId } = await provision({ timezone: "UTC" });
    const now = new Date("2026-06-14T12:00:00Z");
    const today = localDate("UTC", now);
    const { projectId } = await addGoalProject(workspaceId, 8);
    const ms = await addMilestone(workspaceId, projectId, 0);
    const wp = await addWp(workspaceId, projectId, ms, 0);
    const t = await addTask(workspaceId, wp, { estimate: 2 });

    // A past day the slippage detector marked 'slipped' — the day status flips but the
    // item stays 'planned' (invariant #5). The work didn't happen and still needs doing.
    const day = await db.insertInto("daily_plan_day")
      .values({ workspace_id: workspaceId, plan_date: "2026-06-10", status: "slipped", confirmed_at: now })
      .returning("id").executeTakeFirstOrThrow();
    await db.insertInto("daily_plan_item").values({
      workspace_id: workspaceId, daily_plan_day_id: day.id, item_type: "task",
      task_id: t, status: "planned", origin: "proposed", position: 0,
    }).execute();

    const { taskDate, milestoneDate } = await projectSchedule(db, ctx, { now });
    expect(taskDate.get(t)).toBe(today); // re-projected forward, NOT stuck on 2026-06-10
    expect(milestoneDate.get(ms)).toBe(today);

    // And it surfaces in GET /roadmap's projected region (the path ahead).
    const roadmap = await getRoadmap(db, ctx, { now });
    const projectedTaskIds = roadmap.days
      .filter((d) => d.projected)
      .flatMap((d) => d.items.map((i) => i.task_id));
    expect(projectedTaskIds).toContain(t);
  });
});

// ---- GET /roadmap -----------------------------------------------------------
describe("GET /roadmap", () => {
  it("merges persisted days with projected days and writes nothing", async () => {
    const { ctx, workspaceId } = await provision({ timezone: "UTC" });
    const now = new Date("2026-06-14T12:00:00Z");
    const today = localDate("UTC", now);
    const { projectId } = await addGoalProject(workspaceId, 8);
    const wp = await addWp(workspaceId, projectId, null, 0);
    const planned = await addTask(workspaceId, wp, { estimate: 2, position: 0 });
    const future = await addTask(workspaceId, wp, { estimate: 2, position: 1 });

    // Persist a confirmed day TODAY with the first task on it.
    const day = await db.insertInto("daily_plan_day")
      .values({ workspace_id: workspaceId, plan_date: today, status: "confirmed", confirmed_at: now })
      .returning("id").executeTakeFirstOrThrow();
    await db.insertInto("daily_plan_item").values({
      workspace_id: workspaceId, daily_plan_day_id: day.id, item_type: "task",
      task_id: planned, status: "planned", origin: "proposed", position: 0,
    }).execute();

    const before = await rowCounts(workspaceId);
    const roadmap = await getRoadmap(db, ctx, { now });
    const after = await rowCounts(workspaceId);

    expect(after).toEqual(before); // #5: pure read

    const todayDay = roadmap.days.find((d) => d.date === today)!;
    expect(todayDay.projected).toBe(false);
    expect(todayDay.status).toBe("confirmed");
    expect(todayDay.items[0]!.task).toMatchObject({
      id: planned,
      title: "T",
      status: "todo",
      project_id: projectId,
      project_title: "P",
      work_package_id: wp,
      work_package_title: "WP",
      estimate_hours: "2",
      difficulty: null,
      is_time_fixed: false,
      fixed_date: null,
      blocked: false,
    });

    const projectedDays = roadmap.days.filter((d) => d.projected);
    expect(projectedDays.length).toBeGreaterThan(0);
    // The future (unplanned) task appears in a projected day; the persisted one does not double-show.
    const projectedTaskIds = projectedDays.flatMap((d) => d.items.map((i) => i.task_id));
    expect(projectedTaskIds).toContain(future);
    expect(projectedTaskIds).not.toContain(planned);
    expect(roadmap.position.today).toBe(today);
  });

  it("keeps an ACHIEVED milestone in the list (achieved + achieved_date), not dropped when projection can't date it", async () => {
    // Regression (F5 gap-fix): once every WP completes there's no incomplete work to
    // project, so projected_date goes null. Without achieved_date the landmark would
    // disappear from the roadmap instead of lighting up green.
    const { ctx, workspaceId } = await provision({ timezone: "UTC" });
    const now = new Date("2026-06-14T12:00:00Z");
    const { projectId } = await addGoalProject(workspaceId, 8);
    const ms = await addMilestone(workspaceId, projectId, 0);
    const wp = await addWp(workspaceId, projectId, ms, 0);
    const t = await addTask(workspaceId, wp, { estimate: 2 });

    // Achieve it the way the completion cascade does: task done, WP cache set, milestone achieved.
    const achievedAt = new Date("2026-06-13T09:00:00Z");
    await db.updateTable("task").set({ status: "done", completed_at: now }).where("id", "=", t).execute();
    await db.updateTable("work_package").set({ completed_at: now }).where("id", "=", wp).execute();
    await db.updateTable("milestone").set({ achieved_at: achievedAt }).where("id", "=", ms).execute();

    const roadmap = await getRoadmap(db, ctx, { now });
    const entry = roadmap.milestones.find((m) => m.id === ms);
    expect(entry).toBeTruthy(); // still present, NOT dropped
    expect(entry!.achieved).toBe(true);
    expect(entry!.achieved_date).toBe(localDate("UTC", achievedAt)); // anchored at achievement
    expect(entry!.projected_date).toBeNull(); // no incomplete work left to project
  });
});

// ---- Activation: the deferred-item payoff ----------------------------------
describe("deferred-item activation", () => {
  it("flow next_milestone.projected_date is now a real date (was null pre-Phase-6)", async () => {
    const { ctx, workspaceId } = await provision({ timezone: "UTC" });
    const now = new Date("2026-06-14T12:00:00Z");
    const today = localDate("UTC", now);
    const { projectId } = await addGoalProject(workspaceId, 8);
    const ms = await addMilestone(workspaceId, projectId, 0);
    const wpA = await addWp(workspaceId, projectId, ms, 0);
    const wpB = await addWp(workspaceId, projectId, ms, 1);
    const a = await addTask(workspaceId, wpA, { estimate: 2, position: 0 });
    const b = await addTask(workspaceId, wpB, { estimate: 2, position: 1 });
    await addTaskDep(workspaceId, a, b);

    const flow = await getProjectFlow(db, ctx, projectId, now);
    expect(flow.next_milestone?.id).toBe(ms);
    expect(flow.next_milestone?.projected_date).toBe(addDays(today, 1)); // B's day, the gate
  });

  it("the projected_date a replan shows for a milestone EQUALS what /roadmap shows", async () => {
    const { ctx, workspaceId } = await provision({ timezone: "UTC" });
    const now = new Date("2026-06-14T12:00:00Z");
    const { projectId } = await addGoalProject(workspaceId, 8);
    const ms = await addMilestone(workspaceId, projectId, 0);
    const wp = await addWp(workspaceId, projectId, ms, 0);
    await addTask(workspaceId, wp, { estimate: 2, position: 0 });

    const roadmap = await getRoadmap(db, ctx, { now });
    const roadmapDate = roadmap.milestones.find((m) => m.id === ms)!.projected_date;

    const { changes } = await analyzeReplan(db, ctx, { now });
    const impact = changes.milestone_impacts.find((i) => i.milestone_id === ms)!;
    expect(impact.to_projected_date).toBe(roadmapDate); // unified by the shared helper
    expect(roadmapDate).not.toBeNull();
  });
});

// ---- Daily-planning edit endpoints -----------------------------------------
describe("daily-planning edits", () => {
  it("getDay returns the day + records engagement today, 404s when absent", async () => {
    const { ctx, userId, workspaceId } = await provision({ timezone: "UTC" });
    const now = new Date("2026-06-14T12:00:00Z");
    const today = localDate("UTC", now);
    const day = await db.insertInto("daily_plan_day")
      .values({ workspace_id: workspaceId, plan_date: today, status: "confirmed", confirmed_at: now })
      .returning("id").executeTakeFirstOrThrow();
    const { projectId } = await addGoalProject(workspaceId, 8);
    const wp = await addWp(workspaceId, projectId, null, 0);
    const task = await addTask(workspaceId, wp, { estimate: 3 });
    await db.insertInto("daily_plan_item").values({
      workspace_id: workspaceId,
      daily_plan_day_id: day.id,
      item_type: "task",
      task_id: task,
      status: "planned",
      origin: "user_added",
      position: 0,
    }).execute();

    const view = await getDay(db, ctx, today, now);
    expect(view.day.id).toBe(day.id);
    expect(view.items[0]!.task).toMatchObject({
      id: task,
      project_id: projectId,
      work_package_id: wp,
      estimate_hours: "3",
      blocked: false,
    });
    const eng = await db.selectFrom("engagement_day").select("activity_date")
      .where("user_id", "=", userId).where("activity_date", "=", today).executeTakeFirst();
    expect(eng).toBeTruthy(); // ⚡eng on viewing today

    await expect(getDay(db, ctx, "2026-06-20", now)).rejects.toMatchObject({ status: 404 });
  });

  it("addItem: adds unblocked, rejects blocked (422), dup (409), and planned-elsewhere (409)", async () => {
    const { ctx, workspaceId } = await provision({ timezone: "UTC" });
    const now = new Date("2026-06-14T12:00:00Z");
    const today = localDate("UTC", now);
    const { projectId } = await addGoalProject(workspaceId, 8);
    const wp = await addWp(workspaceId, projectId, null, 0);
    const t1 = await addTask(workspaceId, wp, { position: 0 });
    const pred = await addTask(workspaceId, wp, { position: 1 });
    const blocked = await addTask(workspaceId, wp, { position: 2 });
    await addTaskDep(workspaceId, pred, blocked); // blocked has an incomplete predecessor

    const item = await addItem(db, ctx, today, t1, null, now);
    expect(item.origin).toBe("user_added");

    await expect(addItem(db, ctx, today, blocked, null, now)).rejects.toMatchObject({ status: 422 });
    await expectMappedStatus(409, () => addItem(db, ctx, today, t1, null, now)); // dup on day
    await expectMappedStatus(409, () => addItem(db, ctx, addDays(today, 1), t1, null, now)); // planned elsewhere
  });

  it("patchItem defers and reorders; deleteItem removes", async () => {
    const { ctx, workspaceId } = await provision({ timezone: "UTC" });
    const now = new Date("2026-06-14T12:00:00Z");
    const today = localDate("UTC", now);
    const { projectId } = await addGoalProject(workspaceId, 8);
    const wp = await addWp(workspaceId, projectId, null, 0);
    const t = await addTask(workspaceId, wp, {});
    const item = await addItem(db, ctx, today, t, null, now);

    const reordered = await patchItem(db, ctx, item.id, { position: 5 });
    expect(reordered.position).toBe(5);
    const deferred = await patchItem(db, ctx, item.id, { status: "deferred" });
    expect(deferred.status).toBe("deferred");
    await expect(patchItem(db, ctx, item.id, { status: "completed" })).rejects.toMatchObject({ status: 422 });

    await deleteItem(db, ctx, item.id, now);
    const gone = await db.selectFrom("daily_plan_item").select("id").where("id", "=", item.id).executeTakeFirst();
    expect(gone).toBeUndefined();
  });

  it("pullForward moves a future task onto today (origin pulled_forward); rejects blocked + already-there", async () => {
    const { ctx, workspaceId } = await provision({ timezone: "UTC" });
    const now = new Date("2026-06-14T12:00:00Z");
    const today = localDate("UTC", now);
    const tomorrow = addDays(today, 1);
    const { projectId } = await addGoalProject(workspaceId, 8);
    const wp = await addWp(workspaceId, projectId, null, 0);
    const t = await addTask(workspaceId, wp, {});

    // Plan it on tomorrow first.
    const tomorrowDay = await db.insertInto("daily_plan_day")
      .values({ workspace_id: workspaceId, plan_date: tomorrow, status: "confirmed", confirmed_at: now })
      .returning("id").executeTakeFirstOrThrow();
    await db.insertInto("daily_plan_item").values({
      workspace_id: workspaceId, daily_plan_day_id: tomorrowDay.id, item_type: "task",
      task_id: t, status: "planned", origin: "proposed", position: 0,
    }).execute();

    const { item } = await pullForward(db, ctx, t, today, now);
    expect(item.origin).toBe("pulled_forward");
    const old = await db.selectFrom("daily_plan_item").select("status")
      .where("daily_plan_day_id", "=", tomorrowDay.id).where("task_id", "=", t).executeTakeFirstOrThrow();
    expect(old.status).toBe("deferred"); // old planned row freed, not duplicated

    await expect(pullForward(db, ctx, t, today, now)).rejects.toMatchObject({ status: 409 }); // already there

    const blockedPred = await addTask(workspaceId, wp, { position: 1 });
    const blockedTask = await addTask(workspaceId, wp, { position: 2 });
    await addTaskDep(workspaceId, blockedPred, blockedTask);
    await expect(pullForward(db, ctx, blockedTask, today, now)).rejects.toMatchObject({ status: 422 });
  });
});
