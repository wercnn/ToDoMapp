/**
 * Tasks — the atomic unit of doing (api-endpoints.md §8). This module covers
 * create/list/read; the side-effect-rich transitions (complete/reopen) live in
 * completion.ts. `blocked` is derived at read time, never stored (data-model §6).
 */
import type { Kysely } from "kysely";
import type { Database, DifficultyLevel, Task, TaskStatus } from "../db/types";
import type { AuthContext } from "../auth/context";
import { withTransaction } from "../db/transaction";
import { addDays, localDate } from "../lib/dates";
import { badRequest, notFound, unprocessable } from "../lib/errors";
import { validateTitle, validateEstimate, validateTimeFixed } from "./validation";
import { getOrCreateDay } from "./planDays";
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
  now: Date = new Date(),
  opts: { autoPlace?: boolean } = {},
): Promise<Task> {
  await assertWorkPackageInWorkspace(db, ctx, wpId);
  const title = validateTitle(input.title);
  validateEstimate(input);
  validateTimeFixed(input);

  return withTransaction(db, async (trx) => {
    const task = await trx
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

    // New work created through the API lands on a CONCRETE day so it can never get lost
    // in a projection: a time-fixed task on its committed date, everything else on
    // TOMORROW. The day is created `proposed` (not confirmed) so a later replan is free
    // to move it — the replan freezes future confirmed days. Dependencies are ignored
    // here; tomorrow is a holding slot and the replan reorders the queue. (Off by
    // default so internal/test callers that seed their own plan are unaffected.)
    if (opts.autoPlace) {
      const placementDate =
        task.is_time_fixed && task.fixed_date
          ? task.fixed_date
          : addDays(localDate(ctx.timezone, now), 1);
      const day = await getOrCreateDay(trx, ctx, placementDate, now, "proposed");
      const maxPos = await trx
        .selectFrom("daily_plan_item")
        .select((eb) => eb.fn.max("position").as("m"))
        .where("workspace_id", "=", ctx.workspaceId)
        .where("daily_plan_day_id", "=", day.id)
        .executeTakeFirst();
      await trx
        .insertInto("daily_plan_item")
        .values({
          workspace_id: ctx.workspaceId,
          daily_plan_day_id: day.id,
          item_type: "task",
          task_id: task.id,
          status: "planned",
          origin: "user_added",
          position: Number(maxPos?.m ?? -1) + 1,
        })
        .execute();
    }

    return task;
  });
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
    .where("work_package_id", "=", wpId)
    .where("replaced_at", "is", null);
  if (filters.status) q = q.where("status", "=", filters.status);
  const tasks = await q.orderBy("position").orderBy("created_at").execute();

  const blocked = await getBlockedTaskIds(db, ctx);
  return tasks.map((t) => ({ ...t, blocked: blocked.has(t.id) }));
}

async function findTask(db: Kysely<Database>, ctx: AuthContext, taskId: string): Promise<Task> {
  const task = await db
    .selectFrom("task")
    .selectAll()
    .where("id", "=", taskId)
    .where("workspace_id", "=", ctx.workspaceId)
    .executeTakeFirst();
  if (!task) throw notFound("Task not found");
  return task;
}

/** Read one task with its derived `blocked` flag (api §8). */
export async function getTask(
  db: Kysely<Database>,
  ctx: AuthContext,
  taskId: string,
): Promise<TaskWithBlocked> {
  const task = await findTask(db, ctx, taskId);
  const blocked = await getBlockedTaskIds(db, ctx);
  return { ...task, blocked: blocked.has(task.id) };
}

export interface UpdateTaskInput {
  title?: unknown;
  notes?: string | null;
  estimate_hours?: number | null;
  difficulty?: DifficultyLevel | null;
  is_time_fixed?: boolean;
  fixed_date?: string | null;
  position?: number;
}

export async function updateTask(
  db: Kysely<Database>,
  ctx: AuthContext,
  taskId: string,
  input: UpdateTaskInput & { status?: unknown; completed_at?: unknown },
): Promise<Task> {
  // status / completed_at are not editable here — they go through the dedicated
  // transitions (complete/reopen) so the cascade and scoring can't be bypassed (api §8).
  if (input.status !== undefined || input.completed_at !== undefined) {
    throw unprocessable("status/completed_at are set via complete/reopen, not PATCH");
  }

  const existing = await findTask(db, ctx, taskId);

  // Validate the MERGED estimate / time-fixed state (same rules as create).
  const effEstimate =
    input.estimate_hours !== undefined
      ? input.estimate_hours
      : existing.estimate_hours != null
        ? Number(existing.estimate_hours)
        : null;
  const effDifficulty = input.difficulty !== undefined ? input.difficulty : existing.difficulty;
  validateEstimate({ estimate_hours: effEstimate, difficulty: effDifficulty });

  const effIsFixed = input.is_time_fixed !== undefined ? input.is_time_fixed : existing.is_time_fixed;
  const effFixedDate = input.fixed_date !== undefined ? input.fixed_date : existing.fixed_date;
  validateTimeFixed({ is_time_fixed: effIsFixed, fixed_date: effFixedDate });

  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (input.title !== undefined) patch.title = validateTitle(input.title);
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.estimate_hours !== undefined) patch.estimate_hours = input.estimate_hours;
  if (input.difficulty !== undefined) patch.difficulty = input.difficulty;
  if (input.is_time_fixed !== undefined) patch.is_time_fixed = input.is_time_fixed;
  if (input.fixed_date !== undefined) patch.fixed_date = input.fixed_date;
  if (input.position !== undefined) {
    if (!Number.isInteger(input.position)) throw badRequest("position must be an integer");
    patch.position = input.position;
  }

  return db
    .updateTable("task")
    .set(patch)
    .where("id", "=", taskId)
    .where("workspace_id", "=", ctx.workspaceId)
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** Delete a task; its dep edges + plan items cascade, ledger rows survive (SET NULL). */
export async function deleteTask(
  db: Kysely<Database>,
  ctx: AuthContext,
  taskId: string,
): Promise<void> {
  const result = await db
    .deleteFrom("task")
    .where("id", "=", taskId)
    .where("workspace_id", "=", ctx.workspaceId)
    .executeTakeFirst();
  if (Number(result.numDeletedRows) === 0) throw notFound("Task not found");
}
