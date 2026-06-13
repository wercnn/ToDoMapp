/**
 * Tasks — the atomic unit of doing (api-endpoints.md §8). This module covers
 * create/list/read; the side-effect-rich transitions (complete/reopen) live in
 * completion.ts. `blocked` is derived at read time, never stored (data-model §6).
 */
import type { Kysely } from "kysely";
import type { Database, DifficultyLevel, Task, TaskStatus } from "../db/types";
import type { AuthContext } from "../auth/context";
import { notFound } from "../lib/errors";
import { validateTitle, validateEstimate, validateTimeFixed } from "./validation";
import { getBlockedTaskIds } from "./blocked";

async function assertWorkPackageInWorkspace(
  db: Kysely<Database>,
  ctx: AuthContext,
  wpId: string,
): Promise<void> {
  const wp = await db
    .selectFrom("work_package")
    .select("id")
    .where("id", "=", wpId)
    .where("workspace_id", "=", ctx.workspaceId)
    .executeTakeFirst();
  if (!wp) throw notFound("Work package not found");
}

export interface CreateTaskInput {
  id?: string;
  title: unknown;
  notes?: string | null;
  estimate_hours?: number | null;
  difficulty?: DifficultyLevel | null;
  is_time_fixed?: boolean;
  fixed_date?: string | null;
  position?: number;
}

export async function createTask(
  db: Kysely<Database>,
  ctx: AuthContext,
  wpId: string,
  input: CreateTaskInput,
): Promise<Task> {
  await assertWorkPackageInWorkspace(db, ctx, wpId);
  const title = validateTitle(input.title);
  validateEstimate(input);
  validateTimeFixed(input);

  return db
    .insertInto("task")
    .values({
      ...(input.id ? { id: input.id } : {}),
      workspace_id: ctx.workspaceId,
      work_package_id: wpId,
      title,
      notes: input.notes ?? null,
      estimate_hours: input.estimate_hours ?? null,
      difficulty: input.difficulty ?? null,
      is_time_fixed: input.is_time_fixed ?? false,
      fixed_date: input.fixed_date ?? null,
      ...(input.position != null ? { position: input.position } : {}),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export interface TaskWithBlocked extends Task {
  blocked: boolean;
}

export async function listTasks(
  db: Kysely<Database>,
  ctx: AuthContext,
  wpId: string,
  filters: { status?: TaskStatus } = {},
): Promise<TaskWithBlocked[]> {
  await assertWorkPackageInWorkspace(db, ctx, wpId);
  let q = db
    .selectFrom("task")
    .selectAll()
    .where("workspace_id", "=", ctx.workspaceId)
    .where("work_package_id", "=", wpId);
  if (filters.status) q = q.where("status", "=", filters.status);
  const tasks = await q.orderBy("position").orderBy("created_at").execute();

  const blocked = await getBlockedTaskIds(db, ctx);
  return tasks.map((t) => ({ ...t, blocked: blocked.has(t.id) }));
}
