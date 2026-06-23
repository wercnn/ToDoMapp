/**
 * Track-3 measurement harness — quantifies the Sidebar's progress fan-out.
 *
 * Builds a realistic WBS (mirrors scripts/seed-demo.ts: 2 goals, 3 projects,
 * 7 work packages, 20 tasks, a third of them done) in a throwaway workspace,
 * then replays what the Sidebar actually does on first paint:
 *   listGoals()  +  for each goal: listProjects(goalId, { includeProgress:true })
 * counting DB round-trips (via Kysely's log hook) and wall time. Run it BEFORE
 * and AFTER the grouped-aggregate change to get honest before/after numbers.
 *
 * Run: npx tsx scripts/measure-sidebar.ts
 */
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { loadEnv } from "./env";
import type { Database } from "../src/db/types";
import { provisionWorkspace, teardownWorkspace } from "../src/testing/fixtures";
import { listGoals } from "../src/domain/goals";
import { listProjects } from "../src/domain/projects";

const env = loadEnv();
const { Pool, types } = pg;
types.setTypeParser(1082, (v: string) => v);

let queryCount = 0;
function makeDb(): Kysely<Database> {
  const pool = new Pool({ connectionString: env.DIRECT_URL!, max: 1 });
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
    log: (event) => {
      if (event.level === "query") queryCount++;
    },
  });
}

// Demo-matching shape: goal -> projects -> per-work-package task counts.
const WORKSPACE_SHAPE: number[][][] = [
  [ [3, 4, 3], [2, 3] ],   // Goal 1: project A (3 wps), project B (2 wps)
  [ [3, 2] ],              // Goal 2: project C (2 wps)
];

async function buildWbs(db: Kysely<Database>, ws: string, goalId: string, projWpTaskCounts: number[][]) {
  for (const [pi, wpCounts] of projWpTaskCounts.entries()) {
    const project = await db
      .insertInto("project")
      .values({ workspace_id: ws, goal_id: goalId, title: `Project ${pi}`, capacity_hours_per_day: 4 })
      .returning("id")
      .executeTakeFirstOrThrow();
    for (const [wi, taskCount] of wpCounts.entries()) {
      const wp = await db
        .insertInto("work_package")
        .values({ workspace_id: ws, project_id: project.id, title: `WP ${wi}`, position: wi })
        .returning("id")
        .executeTakeFirstOrThrow();
      for (let ti = 0; ti < taskCount; ti++) {
        // Mark ~1/3 done, mix of estimate_hours and difficulty.
        const done = ti % 3 === 0;
        await db
          .insertInto("task")
          .values({
            workspace_id: ws,
            work_package_id: wp.id,
            title: `Task ${ti}`,
            position: ti,
            ...(ti % 2 === 0 ? { estimate_hours: 2 } : { difficulty: "mid" as const }),
            ...(done ? { status: "done" as const, completed_at: new Date() } : {}),
          })
          .executeTakeFirstOrThrow();
      }
    }
  }
}

async function main() {
  const db = makeDb();
  const provisioned = await provisionWorkspace(db, { email: `measure-${Date.now()}@example.test` });
  const { ctx } = provisioned;

  let goalCount = 0;
  let projCount = 0;
  let taskCount = 0;
  for (const [gi, projects] of WORKSPACE_SHAPE.entries()) {
    const goal = await db
      .insertInto("goal")
      .values({ workspace_id: ctx.workspaceId, title: `Goal ${gi}`, horizon: "mid" })
      .returning("id")
      .executeTakeFirstOrThrow();
    goalCount++;
    projCount += projects.length;
    for (const wpCounts of projects) taskCount += wpCounts.reduce((a, b) => a + b, 0);
    await buildWbs(db, ctx.workspaceId, goal.id, projects);
  }

  console.log(`Built workspace: ${goalCount} goals, ${projCount} projects, ${taskCount} tasks.`);

  // ---- Replay the Sidebar's first-paint reads ----
  // Warm-up (connection + plan cache) so the timed run isn't paying first-call cost.
  {
    const goals = await listGoals(db, ctx);
    for (const g of goals) await listProjects(db, ctx, g.id, { includeProgress: true });
  }

  const RUNS = 5;
  let clientRequests = 0;
  queryCount = 0;
  const t0 = performance.now();
  for (let r = 0; r < RUNS; r++) {
    const goals = await listGoals(db, ctx); // 1 client request
    clientRequests++;
    for (const g of goals) {
      await listProjects(db, ctx, g.id, { includeProgress: true }); // 1 client request per goal
      clientRequests++;
    }
  }
  const elapsed = performance.now() - t0;

  console.log("\n=== Sidebar first-paint cost (averaged over " + RUNS + " runs) ===");
  console.log(`Client requests per paint : ${clientRequests / RUNS}`);
  console.log(`DB queries per paint      : ${queryCount / RUNS}`);
  console.log(`Wall time per paint       : ${(elapsed / RUNS).toFixed(1)} ms`);

  await teardownWorkspace(db, provisioned);
  await db.destroy();
}

main().catch((e) => {
  console.error("MEASURE FAILED:", e);
  process.exit(1);
});
