/**
 * Replanning-pipeline tests (test-first, DB-backed — same care as the completion
 * cascade). They run against the REAL database so the partial-unique
 * `daily_plan_item_one_planned_per_task` and the resolved-pairing CHECK are
 * exercised as real backstops. Requires DIRECT_URL + an applied schema.
 *
 * The keystone test is "time-fixed in a diff without an explicit choice is REJECTED
 * at apply (422)" — invariant #4.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import { createDb } from "@/db/kysely";
import type { Database } from "@/db/types";
import type { AuthContext } from "@/auth/context";
import { addDays, localDate } from "@/lib/dates";
import {
  approveProposal,
  createProposal,
  rejectProposal,
} from "@/domain/replan/proposals";
import { readTaskRefs } from "@/domain/roadmapRead";
import type { Changes } from "@/domain/replan/types";
import { createWorkPackage } from "@/domain/workPackages";
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
    throw new Error("DIRECT_URL is required to run the replan tests (they hit Postgres).");
  }
  db = createDb(env.DIRECT_URL);
});

afterAll(async () => {
  if (db) await db.destroy();
});

describe("replanning pipeline", () => {
  let ws: { ctx: AuthContext; userId: string; workspaceId: string };
  let scenario: Scenario;
  let now: Date;
  let today: string;
  let tomorrow: string;
  let dayAfter: string;

  beforeEach(async () => {
    ws = await provisionWorkspace(db, { timezone: "UTC" });
    now = new Date();
    today = localDate("UTC", now);
    tomorrow = addDays(today, 1);
    dayAfter = addDays(today, 2);
    // Seeds: project(cap 8) → M → WP1→T1, WP2→T2; day D=today (proposed) planning T1,T2.
    scenario = await seedScenario(db, ws.ctx, { planDate: today });
  });

  afterEach(async () => {
    await teardownWorkspace(db, ws);
  });

  // --- helpers ---------------------------------------------------------------

  async function insertProposal(
    changes: Partial<Changes>,
    trigger: "user_request" | "new_work_package" | "slippage" = "user_request",
  ) {
    const full: Changes = {
      moves: [],
      milestone_impacts: [],
      time_fixed_conflicts: [],
      ...changes,
    };
    return db
      .insertInto("replan_proposal")
      .values({
        workspace_id: ws.workspaceId,
        trigger,
        status: "pending",
        summary: "test proposal",
        changes: JSON.stringify(full),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async function planItems(taskId: string) {
    return db
      .selectFrom("daily_plan_item as dpi")
      .innerJoin("daily_plan_day as d", "d.id", "dpi.daily_plan_day_id")
      .select(["dpi.id as id", "dpi.status as status", "dpi.origin as origin", "d.plan_date as planDate"])
      .where("dpi.task_id", "=", taskId)
      .where("dpi.workspace_id", "=", ws.workspaceId)
      .orderBy("d.plan_date")
      .execute();
  }

  async function makeTimeFixed(taskId: string, fixedDate: string) {
    await db
      .updateTable("task")
      .set({ is_time_fixed: true, fixed_date: fixedDate })
      .where("id", "=", taskId)
      .execute();
  }

  async function lockDay(dayId: string) {
    await db.updateTable("daily_plan_day").set({ is_locked: true }).where("id", "=", dayId).execute();
  }

  async function proposalStatus(id: string) {
    const row = await db
      .selectFrom("replan_proposal")
      .select(["status", "resolved_at", "applied_changes"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    return row;
  }

  // --- the keystone ----------------------------------------------------------

  it("REJECTS (422) a diff that moves a time-fixed item without an explicit choice, writing nothing", async () => {
    await makeTimeFixed(scenario.t1Id, today);
    const proposal = await insertProposal({
      moves: [{ task_id: scenario.t1Id, from_date: today, to_date: tomorrow }],
    });

    await expect(approveProposal(db, ws.ctx, proposal.id, { now })).rejects.toMatchObject({
      status: 422,
    });

    // Plan untouched: T1 still planned on today, no replanned successor.
    const items = await planItems(scenario.t1Id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ status: "planned", planDate: today });
    // Full rollback: proposal stays pending.
    expect((await proposalStatus(proposal.id)).status).toBe("pending");
  });

  it("ALLOWS a time-fixed move when an explicit renegotiate choice is supplied", async () => {
    await makeTimeFixed(scenario.t1Id, today);
    const proposal = await insertProposal({}); // stored diff irrelevant; edits drive apply

    const edits = {
      moves: [{ task_id: scenario.t1Id, from_date: today, to_date: dayAfter }],
      time_fixed_resolutions: [
        { task_id: scenario.t1Id, choice: "renegotiate", new_fixed_date: dayAfter },
      ],
    };
    const { proposal: resolved } = await approveProposal(db, ws.ctx, proposal.id, { edits, now });

    expect(resolved.status).toBe("edited_approved");
    const items = await planItems(scenario.t1Id);
    const deferred = items.find((i) => i.planDate === today);
    const moved = items.find((i) => i.planDate === dayAfter);
    expect(deferred).toMatchObject({ status: "deferred" });
    expect(moved).toMatchObject({ status: "planned", origin: "replanned" });
    // renegotiate updated the commitment date.
    const task = await db
      .selectFrom("task")
      .select("fixed_date")
      .where("id", "=", scenario.t1Id)
      .executeTakeFirstOrThrow();
    expect(task.fixed_date).toBe(dayAfter);
    // applied_changes records what was actually applied.
    expect((await proposalStatus(proposal.id)).applied_changes).toBeTruthy();
  });

  // --- approve / reject happy paths -----------------------------------------

  it("approve applies a flexible diff: old item deferred, new item origin='replanned'", async () => {
    const proposal = await insertProposal({
      moves: [{ task_id: scenario.t1Id, from_date: today, to_date: tomorrow }],
      milestone_impacts: [
        {
          milestone_id: scenario.milestoneId,
          title: "Seed Milestone",
          from_projected_date: today,
          to_projected_date: tomorrow,
        },
      ],
    });

    const { proposal: resolved, applied } = await approveProposal(db, ws.ctx, proposal.id, { now });
    expect(resolved.status).toBe("approved");
    expect(applied.items).toHaveLength(1);

    const t1 = await planItems(scenario.t1Id);
    expect(t1.find((i) => i.planDate === today)).toMatchObject({ status: "deferred" });
    expect(t1.find((i) => i.planDate === tomorrow)).toMatchObject({
      status: "planned",
      origin: "replanned",
    });
    // T2 untouched.
    const t2 = await planItems(scenario.t2Id);
    expect(t2).toHaveLength(1);
    expect(t2[0]).toMatchObject({ status: "planned", planDate: today });

    // ⚡eng recorded (Principle 3 — replanning keeps the streak).
    const eng = await db
      .selectFrom("engagement_day")
      .select("activity_date")
      .where("user_id", "=", ws.userId)
      .where("activity_date", "=", today)
      .executeTakeFirst();
    expect(eng).toBeTruthy();
  });

  it("proposal task refs carry readable project/work-package context", async () => {
    const refs = await readTaskRefs(db, ws.ctx, [scenario.t1Id]);
    expect(refs.get(scenario.t1Id)).toMatchObject({
      id: scenario.t1Id,
      title: "Task T1",
      project_id: scenario.projectId,
      project_title: "Seed Project",
      work_package_id: scenario.wp1Id,
      work_package_title: "Work Package 1",
      estimate_hours: "2",
      blocked: false,
    });
  });

  it("reject leaves the plan exactly as it was, and still counts as engagement", async () => {
    const before = await db
      .selectFrom("daily_plan_item")
      .selectAll()
      .where("workspace_id", "=", ws.workspaceId)
      .orderBy("id")
      .execute();

    const proposal = await insertProposal({
      moves: [{ task_id: scenario.t1Id, from_date: today, to_date: tomorrow }],
    });
    const rejected = await rejectProposal(db, ws.ctx, proposal.id, { now });
    expect(rejected.status).toBe("rejected");
    expect(rejected.resolved_at).toBeTruthy();

    const after = await db
      .selectFrom("daily_plan_item")
      .selectAll()
      .where("workspace_id", "=", ws.workspaceId)
      .orderBy("id")
      .execute();
    expect(after).toEqual(before);

    const eng = await db
      .selectFrom("engagement_day")
      .select("activity_date")
      .where("user_id", "=", ws.userId)
      .executeTakeFirst();
    expect(eng).toBeTruthy();
  });

  // --- locked days: untouchable in BOTH directions ---------------------------

  it("REJECTS (422) a move OFF a locked day (from_date locked), leaving it intact", async () => {
    await lockDay(scenario.dayId); // lock today (the source day)
    const proposal = await insertProposal({
      moves: [{ task_id: scenario.t1Id, from_date: today, to_date: tomorrow }],
    });
    await expect(approveProposal(db, ws.ctx, proposal.id, { now })).rejects.toMatchObject({
      status: 422,
    });
    const items = await planItems(scenario.t1Id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ status: "planned", planDate: today });
  });

  it("REJECTS (422) a move ONTO a locked day (to_date locked)", async () => {
    const lockedTarget = await db
      .insertInto("daily_plan_day")
      .values({ workspace_id: ws.workspaceId, plan_date: tomorrow, status: "confirmed", is_locked: true })
      .returningAll()
      .executeTakeFirstOrThrow();
    expect(lockedTarget.is_locked).toBe(true);

    const proposal = await insertProposal({
      moves: [{ task_id: scenario.t1Id, from_date: today, to_date: tomorrow }],
    });
    await expect(approveProposal(db, ws.ctx, proposal.id, { now })).rejects.toMatchObject({
      status: 422,
    });
    // Source item untouched.
    expect((await planItems(scenario.t1Id))[0]).toMatchObject({ status: "planned", planDate: today });
  });

  // --- idempotency & superseding --------------------------------------------

  it("cannot double-apply: re-approving a resolved proposal is 409 and does not double-mutate", async () => {
    const proposal = await insertProposal({
      moves: [{ task_id: scenario.t1Id, from_date: today, to_date: tomorrow }],
    });
    await approveProposal(db, ws.ctx, proposal.id, { now });
    await expect(approveProposal(db, ws.ctx, proposal.id, { now })).rejects.toMatchObject({
      status: 409,
    });
    // Exactly one replanned successor exists.
    const replanned = (await planItems(scenario.t1Id)).filter((i) => i.origin === "replanned");
    expect(replanned).toHaveLength(1);
  });

  it("two simultaneous approves on the same pending proposal: exactly one wins, one is 409, one successor", async () => {
    const proposal = await insertProposal({
      moves: [{ task_id: scenario.t1Id, from_date: today, to_date: tomorrow }],
    });

    // Fire both claims concurrently — the claim-first UPDATE ... WHERE status='pending'
    // (row-count asserted) is the guard: the loser finds zero pending rows and rolls back.
    const results = await Promise.allSettled([
      approveProposal(db, ws.ctx, proposal.id, { now }),
      approveProposal(db, ws.ctx, proposal.id, { now }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ status: 409 });

    // The race must not double-mutate: exactly one 'replanned' successor exists.
    const replanned = (await planItems(scenario.t1Id)).filter((i) => i.origin === "replanned");
    expect(replanned).toHaveLength(1);
    // And exactly one deferral of the original item.
    const deferred = (await planItems(scenario.t1Id)).filter((i) => i.status === "deferred");
    expect(deferred).toHaveLength(1);
  });

  it("approving an expired (superseded) proposal is 409", async () => {
    const a = await createProposal(db, ws.ctx, { trigger: "user_request", now });
    await createProposal(db, ws.ctx, { trigger: "user_request", now }); // supersedes A
    expect((await proposalStatus(a.id)).status).toBe("expired");
    await expect(approveProposal(db, ws.ctx, a.id, { now })).rejects.toMatchObject({ status: 409 });
  });

  it("a newer pending proposal expires the older one", async () => {
    const a = await createProposal(db, ws.ctx, { trigger: "user_request", now });
    const b = await createProposal(db, ws.ctx, { trigger: "user_request", now });
    expect((await proposalStatus(a.id)).status).toBe("expired");
    expect((await proposalStatus(b.id)).status).toBe("pending");
  });

  // --- new_work_package trigger ---------------------------------------------

  it("WP create against a confirmed roadmap emits a pending proposal and does NOT touch the plan", async () => {
    // Confirm today's roadmap day.
    await db
      .updateTable("daily_plan_day")
      .set({ status: "confirmed", confirmed_at: now })
      .where("id", "=", scenario.dayId)
      .execute();

    const before = await db
      .selectFrom("daily_plan_item")
      .selectAll()
      .where("workspace_id", "=", ws.workspaceId)
      .orderBy("id")
      .execute();

    const result = await createWorkPackage(db, ws.ctx, scenario.projectId, { title: "Mid-flight WP" });
    expect(result.replan_proposal).toBeTruthy();
    expect(result.replan_proposal?.status).toBe("pending");
    expect(result.replan_proposal?.trigger).toBe("new_work_package");

    // Roadmap unchanged — only a proposal was raised.
    const after = await db
      .selectFrom("daily_plan_item")
      .selectAll()
      .where("workspace_id", "=", ws.workspaceId)
      .orderBy("id")
      .execute();
    expect(after).toEqual(before);
  });

  it("WP create with no confirmed roadmap returns just the work package (no proposal)", async () => {
    // seedScenario's day is 'proposed', not confirmed.
    const result = await createWorkPackage(db, ws.ctx, scenario.projectId, { title: "Early WP" });
    expect(result.work_package).toBeTruthy();
    expect(result.replan_proposal).toBeUndefined();
  });
});
