/**
 * Spine guards — the load-bearing Phase-1 paths that were "live-verified over HTTP"
 * once but had no automated coverage. This suite pins them so a refactor can't
 * silently break them:
 *
 *  - proposeRoadmap → confirmDay: the ONLY path from a proposed day to the rendered
 *    roadmap (invariant #5). Confirming flips proposed→confirmed and records ⚡eng;
 *    re-confirming a non-proposed day is a 409 (the path-rendering gate), an absent
 *    day is a 404.
 *  - create-path estimation/time-fixed invariants, asserted AT THE API LAYER: the
 *    domain throws a 422 ApiError BEFORE the insert — not a raw DB CHECK error. The
 *    DB CHECK stays the backstop, but the contract's 422 is the app's job.
 *  - bootstrap idempotency: a repeat call for the same auth_subject returns the
 *    existing user/workspace (created:false), never a second provisioning.
 *
 * Requires DIRECT_URL + applied schema.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import { createDb } from "@/db/kysely";
import type { Database } from "@/db/types";
import { bootstrap } from "@/domain/bootstrap";
import { createGoal } from "@/domain/goals";
import { createProject } from "@/domain/projects";
import { createWorkPackage } from "@/domain/workPackages";
import { createTask } from "@/domain/tasks";
import { proposeRoadmap, confirmDay } from "@/domain/roadmap";
import { ApiError } from "@/lib/errors";
import { localDate } from "@/lib/dates";
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
    throw new Error("DIRECT_URL is required to run the spine tests (they hit Postgres).");
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

/** Minimal schedulable WBS: goal → project(cap 8) → WP → one 2h task. */
async function seedSchedulable(p: ProvisionedWorkspace): Promise<{ wpId: string; taskId: string }> {
  const goal = await createGoal(db, p.ctx, { title: "Spine Goal", horizon: "mid" });
  const project = await createProject(db, p.ctx, goal.id, {
    title: "Spine Project",
    capacity_hours_per_day: 8,
  });
  const wp = await createWorkPackage(db, p.ctx, project.id, { title: "Spine WP" });
  const task = await createTask(db, p.ctx, wp.work_package.id, {
    title: "Spine Task",
    estimate_hours: 2,
  });
  return { wpId: wp.work_package.id, taskId: task.id };
}

describe("roadmap spine: propose → confirm", () => {
  it("proposes a day with the task, then confirms it (proposed→confirmed + ⚡eng)", async () => {
    const p = await provision();
    const { taskId } = await seedSchedulable(p);
    const now = new Date("2026-06-14T09:00:00Z");
    const today = localDate(p.ctx.timezone, now);

    const proposed = await proposeRoadmap(db, p.ctx, { now });
    const todayDraft = proposed.find((d) => d.day.plan_date === today);
    expect(todayDraft).toBeDefined();
    expect(todayDraft!.day.status).toBe("proposed");
    expect(todayDraft!.items.some((i) => i.task_id === taskId)).toBe(true);

    const confirmed = await confirmDay(db, p.ctx, today, now);
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.confirmed_at).not.toBeNull();

    // ⚡eng fired: streak is alive.
    const stats = await db
      .selectFrom("user_stats")
      .select("current_streak")
      .where("user_id", "=", p.userId)
      .executeTakeFirstOrThrow();
    expect(stats.current_streak).toBe(1);
  });

  it("rejects re-confirming an already-confirmed day with 409 (the path-rendering gate)", async () => {
    const p = await provision();
    await seedSchedulable(p);
    const now = new Date("2026-06-14T09:00:00Z");
    const today = localDate(p.ctx.timezone, now);

    await proposeRoadmap(db, p.ctx, { now });
    await confirmDay(db, p.ctx, today, now);

    await expect(confirmDay(db, p.ctx, today, now)).rejects.toMatchObject({ status: 409 });
  });

  it("returns 404 confirming a date with no persisted day", async () => {
    const p = await provision();
    await expect(confirmDay(db, p.ctx, "2026-06-20")).rejects.toMatchObject({ status: 404 });
  });
});

describe("create-path invariants are enforced at the API layer (422 ApiError, not the DB CHECK)", () => {
  it("work package: estimate_hours AND difficulty → 422", async () => {
    const p = await provision();
    const goal = await createGoal(db, p.ctx, { title: "G", horizon: "mid" });
    const project = await createProject(db, p.ctx, goal.id, {
      title: "P",
      capacity_hours_per_day: 8,
    });
    const err = await createWorkPackage(db, p.ctx, project.id, {
      title: "Bad WP",
      estimate_hours: 3,
      difficulty: "mid",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError); // app-layer, thrown before any insert
    expect(err.status).toBe(422);
  });

  it("task: estimate_hours AND difficulty → 422", async () => {
    const p = await provision();
    const { wpId } = await seedSchedulable(p);
    const err = await createTask(db, p.ctx, wpId, {
      title: "Bad Task",
      estimate_hours: 3,
      difficulty: "high",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
  });

  it("task: is_time_fixed without fixed_date → 422", async () => {
    const p = await provision();
    const { wpId } = await seedSchedulable(p);
    const err = await createTask(db, p.ctx, wpId, {
      title: "Fixed but undated",
      is_time_fixed: true,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
  });

  it("task: fixed_date without is_time_fixed → 422", async () => {
    const p = await provision();
    const { wpId } = await seedSchedulable(p);
    const err = await createTask(db, p.ctx, wpId, {
      title: "Dated but not fixed",
      fixed_date: "2026-07-01",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
  });
});

describe("bootstrap idempotency", () => {
  it("a repeat call for the same auth_subject returns the existing records (created:false)", async () => {
    const p = await provision();
    // provisionWorkspace already bootstrapped p.subject once; do it again.
    const again = await bootstrap(db, {
      subject: p.subject,
      input: { email: "ignored@example.test", display_name: "Should Not Replace" },
    });
    expect(again.created).toBe(false);
    expect(again.user.id).toBe(p.userId);
    expect(again.workspace.id).toBe(p.workspaceId);
  });
});
