/**
 * Dependency-edge tests (api-endpoints.md §9, data-model.md §4.3). DB-backed: they
 * exercise the real PK (duplicate-edge guard) and prove the acyclicity BFS catches
 * transitive cycles, not just direct back-edges. Requires DIRECT_URL + applied schema.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import { createDb } from "@/db/kysely";
import type { Database } from "@/db/types";
import type { AuthContext } from "@/auth/context";
import { localDate } from "@/lib/dates";
import { ApiError, mapDbError } from "@/lib/errors";
import { getBlockedTaskIds } from "@/domain/blocked";
import {
  createTaskDependency,
  createWorkPackageDependency,
} from "@/domain/dependencies";
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
    throw new Error(
      "DIRECT_URL is required to run the dependency tests (they hit Postgres). See .env.example.",
    );
  }
  db = createDb(env.DIRECT_URL);
});

afterAll(async () => {
  if (db) await db.destroy();
});

/** Assert `fn` throws an ApiError with the given status. */
async function expectApiError(status: number, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(status);
    return;
  }
  throw new Error(`expected ApiError ${status}, but nothing was thrown`);
}

/** Create a bare task under a work package; returns its id. */
async function makeTask(ctx: AuthContext, wpId: string, title: string, position = 0): Promise<string> {
  const row = await db
    .insertInto("task")
    .values({ workspace_id: ctx.workspaceId, work_package_id: wpId, title, estimate_hours: 1, position })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

describe("dependency edges", () => {
  let ws: { ctx: AuthContext; userId: string; workspaceId: string };
  let scenario: Scenario;

  beforeEach(async () => {
    ws = await provisionWorkspace(db, { timezone: "UTC" });
    scenario = await seedScenario(db, ws.ctx, { planDate: localDate("UTC", new Date()) });
  });

  afterEach(async () => {
    await teardownWorkspace(db, ws);
  });

  it("creates a task→task edge but blocked-state ignores manual task edges", async () => {
    const b = await makeTask(ws.ctx, scenario.wp1Id, "B", -1);
    const edge = await createTaskDependency(db, ws.ctx, {
      predecessor_task_id: scenario.t1Id,
      successor_task_id: b,
    });
    expect(edge.predecessor_task_id).toBe(scenario.t1Id);
    expect(edge.successor_task_id).toBe(b);

    const blocked = await getBlockedTaskIds(db, ws.ctx);
    expect(blocked.has(b)).toBe(false);
    expect(blocked.has(scenario.t1Id)).toBe(true);
  });

  it("blocks later-position tasks until earlier tasks in the same work package are done", async () => {
    const b = await makeTask(ws.ctx, scenario.wp1Id, "B", 1);
    let blocked = await getBlockedTaskIds(db, ws.ctx);
    expect(blocked.has(b)).toBe(true);

    await db.updateTable("task").set({ status: "done", completed_at: new Date() }).where("id", "=", scenario.t1Id).execute();
    blocked = await getBlockedTaskIds(db, ws.ctx);
    expect(blocked.has(b)).toBe(false);
  });

  it("rejects a task dependency across work packages with 422", async () => {
    await expectApiError(422, () =>
      createTaskDependency(db, ws.ctx, {
        predecessor_task_id: scenario.t1Id,
        successor_task_id: scenario.t2Id,
      }),
    );
  });

  it("rejects a self-dependency with 422", async () => {
    await expectApiError(422, () =>
      createTaskDependency(db, ws.ctx, {
        predecessor_task_id: scenario.t1Id,
        successor_task_id: scenario.t1Id,
      }),
    );
  });

  it("rejects a duplicate edge via the PK (mapped to 409)", async () => {
    const b = await makeTask(ws.ctx, scenario.wp1Id, "B");
    await createTaskDependency(db, ws.ctx, {
      predecessor_task_id: scenario.t1Id,
      successor_task_id: b,
    });
    try {
      await createTaskDependency(db, ws.ctx, {
        predecessor_task_id: scenario.t1Id,
        successor_task_id: b,
      });
      throw new Error("expected a duplicate-edge error");
    } catch (err) {
      // Domain surfaces the raw pg error; the HTTP layer maps it to 409.
      expect(mapDbError(err)?.status).toBe(409);
    }
  });

  it("rejects a direct 2-cycle with 409", async () => {
    const b = await makeTask(ws.ctx, scenario.wp1Id, "B");
    await createTaskDependency(db, ws.ctx, {
      predecessor_task_id: scenario.t1Id,
      successor_task_id: b,
    });
    await expectApiError(409, () =>
      createTaskDependency(db, ws.ctx, {
        predecessor_task_id: b,
        successor_task_id: scenario.t1Id,
      }),
    );
  });

  it("rejects a transitive cycle (A→B, B→C, then C→A) with 409", async () => {
    const a = await makeTask(ws.ctx, scenario.wp1Id, "A");
    const b = await makeTask(ws.ctx, scenario.wp1Id, "B");
    const c = await makeTask(ws.ctx, scenario.wp1Id, "C");
    await createTaskDependency(db, ws.ctx, { predecessor_task_id: a, successor_task_id: b });
    await createTaskDependency(db, ws.ctx, { predecessor_task_id: b, successor_task_id: c });
    await expectApiError(409, () =>
      createTaskDependency(db, ws.ctx, { predecessor_task_id: c, successor_task_id: a }),
    );
  });

  it("returns 404 for a node outside the caller's workspace", async () => {
    const other = await provisionWorkspace(db, { timezone: "UTC" });
    const otherScenario = await seedScenario(db, other.ctx, {
      planDate: localDate("UTC", new Date()),
    });
    try {
      await expectApiError(404, () =>
        createTaskDependency(db, ws.ctx, {
          predecessor_task_id: scenario.t1Id,
          successor_task_id: otherScenario.t1Id,
        }),
      );
    } finally {
      await teardownWorkspace(db, other);
    }
  });

  it("rejects a malformed (non-UUID) id with 400", async () => {
    await expectApiError(400, () =>
      createTaskDependency(db, ws.ctx, {
        predecessor_task_id: scenario.t1Id,
        successor_task_id: "not-a-uuid",
      }),
    );
  });

  it("creates a WP→WP edge and blocks tasks in the downstream work package", async () => {
    const edge = await createWorkPackageDependency(db, ws.ctx, {
      predecessor_wp_id: scenario.wp1Id,
      successor_wp_id: scenario.wp2Id,
    });
    expect(edge.predecessor_wp_id).toBe(scenario.wp1Id);

    // wp1 is incomplete, so tasks inside wp2 (t2) are blocked at planner level.
    const blocked = await getBlockedTaskIds(db, ws.ctx);
    expect(blocked.has(scenario.t2Id)).toBe(true);
    expect(blocked.has(scenario.t1Id)).toBe(false);
  });

  it("rejects a WP dependency across projects with 422", async () => {
    const otherProject = await db
      .insertInto("project")
      .values({
        workspace_id: ws.workspaceId,
        goal_id: scenario.goalId,
        title: "Other Project",
        capacity_hours_per_day: 4,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const otherWp = await db
      .insertInto("work_package")
      .values({
        workspace_id: ws.workspaceId,
        project_id: otherProject.id,
        title: "Other WP",
        estimate_hours: 1,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    await expectApiError(422, () =>
      createWorkPackageDependency(db, ws.ctx, {
        predecessor_wp_id: scenario.wp1Id,
        successor_wp_id: otherWp.id,
      }),
    );
  });

  it("rejects a transitive WP cycle with 409", async () => {
    const wp3 = await db
      .insertInto("work_package")
      .values({
        workspace_id: ws.ctx.workspaceId,
        project_id: scenario.projectId,
        title: "WP3",
        estimate_hours: 1,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await createWorkPackageDependency(db, ws.ctx, {
      predecessor_wp_id: scenario.wp1Id,
      successor_wp_id: scenario.wp2Id,
    });
    await createWorkPackageDependency(db, ws.ctx, {
      predecessor_wp_id: scenario.wp2Id,
      successor_wp_id: wp3.id,
    });
    await expectApiError(409, () =>
      createWorkPackageDependency(db, ws.ctx, {
        predecessor_wp_id: wp3.id,
        successor_wp_id: scenario.wp1Id,
      }),
    );
  });
});
