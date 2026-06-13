/**
 * Reusable fixtures for tests and the seed script. `seedScenario` builds a small
 * but complete WBS with a milestone and a planned day so the completion cascade
 * (and its idempotency) can be exercised — and wiped and re-run — quickly.
 *
 * Scenario shape:
 *   goal → project(P) → milestone(M)
 *                       ├─ work_package WP1 (in M) → task T1
 *                       └─ work_package WP2 (in M) → task T2
 *   daily_plan_day D (= planDate, proposed) carries planned items for T1 and T2.
 *
 * Completing T1 then T2 walks every branch: task points ×2, WP1+WP2 caches,
 * milestone M achieved (extra points), and the daily goal completed.
 */
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { Database } from "../db/types";
import type { AuthContext } from "../auth/context";
import { bootstrap } from "../domain/bootstrap";

export interface ProvisionedWorkspace {
  ctx: AuthContext;
  userId: string;
  workspaceId: string;
  subject: string;
}

/** Provision a fresh user + personal workspace via the real bootstrap path. */
export async function provisionWorkspace(
  db: Kysely<Database>,
  opts: { timezone?: string; subject?: string; email?: string } = {},
): Promise<ProvisionedWorkspace> {
  const subject = opts.subject ?? `test-${randomUUID()}`;
  const email = opts.email ?? `${randomUUID()}@example.test`;
  const { user, workspace } = await bootstrap(db, {
    subject,
    input: { email, display_name: "Test User", timezone: opts.timezone ?? "UTC" },
  });
  const ctx: AuthContext = {
    userId: user.id,
    workspaceId: workspace.id,
    role: "owner",
    timezone: user.timezone,
    email: user.email,
    claims: { subject },
  };
  return { ctx, userId: user.id, workspaceId: workspace.id, subject };
}

export interface Scenario {
  goalId: string;
  projectId: string;
  milestoneId: string;
  wp1Id: string;
  wp2Id: string;
  t1Id: string;
  t2Id: string;
  dayId: string;
  item1Id: string;
  item2Id: string;
}

export async function seedScenario(
  db: Kysely<Database>,
  ctx: AuthContext,
  opts: { planDate: string },
): Promise<Scenario> {
  const ws = ctx.workspaceId;

  const goal = await db
    .insertInto("goal")
    .values({ workspace_id: ws, title: "Seed Goal", horizon: "mid" })
    .returning("id")
    .executeTakeFirstOrThrow();

  const project = await db
    .insertInto("project")
    .values({
      workspace_id: ws,
      goal_id: goal.id,
      title: "Seed Project",
      capacity_hours_per_day: 8,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const milestone = await db
    .insertInto("milestone")
    .values({ workspace_id: ws, project_id: project.id, title: "Seed Milestone" })
    .returning("id")
    .executeTakeFirstOrThrow();

  const wp1 = await db
    .insertInto("work_package")
    .values({
      workspace_id: ws,
      project_id: project.id,
      milestone_id: milestone.id,
      title: "Work Package 1",
      estimate_hours: 2,
      position: 0,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const wp2 = await db
    .insertInto("work_package")
    .values({
      workspace_id: ws,
      project_id: project.id,
      milestone_id: milestone.id,
      title: "Work Package 2",
      estimate_hours: 2,
      position: 1,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const t1 = await db
    .insertInto("task")
    .values({
      workspace_id: ws,
      work_package_id: wp1.id,
      title: "Task T1",
      estimate_hours: 2,
      position: 0,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const t2 = await db
    .insertInto("task")
    .values({
      workspace_id: ws,
      work_package_id: wp2.id,
      title: "Task T2",
      estimate_hours: 2,
      position: 0,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const day = await db
    .insertInto("daily_plan_day")
    .values({ workspace_id: ws, plan_date: opts.planDate, status: "proposed" })
    .returning("id")
    .executeTakeFirstOrThrow();

  const item1 = await db
    .insertInto("daily_plan_item")
    .values({
      workspace_id: ws,
      daily_plan_day_id: day.id,
      item_type: "task",
      task_id: t1.id,
      status: "planned",
      origin: "proposed",
      position: 0,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const item2 = await db
    .insertInto("daily_plan_item")
    .values({
      workspace_id: ws,
      daily_plan_day_id: day.id,
      item_type: "task",
      task_id: t2.id,
      status: "planned",
      origin: "proposed",
      position: 1,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  return {
    goalId: goal.id,
    projectId: project.id,
    milestoneId: milestone.id,
    wp1Id: wp1.id,
    wp2Id: wp2.id,
    t1Id: t1.id,
    t2Id: t2.id,
    dayId: day.id,
    item1Id: item1.id,
    item2Id: item2.id,
  };
}

/** Delete a provisioned workspace and its user (FK cascades clean everything). */
export async function teardownWorkspace(
  db: Kysely<Database>,
  ws: { workspaceId: string; userId: string },
): Promise<void> {
  await db.deleteFrom("workspace").where("id", "=", ws.workspaceId).execute();
  await db.deleteFrom("app_user").where("id", "=", ws.userId).execute();
}
