/**
 * Roadmap PROJECTION (api-endpoints.md §10, data-model.md §6 "Roadmap beyond
 * confirmed days"). The roadmap is a projection, NOT a stored artifact: only
 * proposed/confirmed `daily_plan_day` rows are persisted; everything beyond is
 * recomputed here on demand. This module is a READ-ONLY consumer of the pure
 * planner (Decision #19) — it opens no transaction and writes nothing.
 *
 * Unlike `/propose` (near-horizon, schedules only already-unblocked work and
 * re-proposes as tasks complete), the projection re-derives where EVERY incomplete
 * task would land across a long horizon, using STAGED UNBLOCKING: dependency edges
 * are handed to the planner so a successor lands the day after its predecessor,
 * instead of being dropped as "blocked" forever. That is what finally yields a
 * `projected_date` for milestones gated behind dependency chains.
 *
 * `projectMilestoneDates` is the single source the flow diagram, the replan diff,
 * and the milestone-approaching nudge all derive milestone dates from — so they
 * agree by construction (no second heuristic). `projected_date` is ALWAYS derived
 * here, never stored (§6): there is deliberately no `milestone.projected_date`
 * column to cache it into and drift from.
 */
import type { Kysely } from "kysely";
import type { Database } from "../db/types";
import type { WorkspaceContext } from "../auth/context";
import { addDays, localDate } from "../lib/dates";
import { planner } from "../planner/index";
import type { DraftDay, TaskEdge } from "../planner/index";
import { resolveHours } from "../planner/constants";

/** Long enough to place the whole remaining graph; unplaced ⇒ null projected_date. */
export const PROJECTION_HORIZON_DAYS = 365;

export interface Projection {
  /** From-scratch projected day-steps for ALL incomplete tasks (not persisted). */
  draft: DraftDay[];
  /** taskId → projected 'YYYY-MM-DD'. Absent ⇒ couldn't be placed (no capacity). */
  taskDate: Map<string, string>;
  /** milestoneId → projected_date, or null when a gating task can't be scheduled. */
  milestoneDate: Map<string, string | null>;
}

interface CandidateRow {
  taskId: string;
  projectId: string;
  workPackageId: string;
  milestoneId: string | null;
  estimateHours: string | null;
  difficulty: "low" | "mid" | "high" | null;
  isTimeFixed: boolean;
  fixedDate: string | null;
  position: number;
}

/**
 * Compute the full projection for the workspace (optionally scoped to one goal).
 * Pure read — assembles the planner input from the DB and interprets the draft.
 */
export async function projectSchedule(
  db: Kysely<Database>,
  ctx: WorkspaceContext,
  opts: { now?: Date; goalId?: string; horizonDays?: number } = {},
): Promise<Projection> {
  const now = opts.now ?? new Date();
  const today = localDate(ctx.timezone, now);
  const horizonDays = opts.horizonDays ?? PROJECTION_HORIZON_DAYS;

  // Planned items on a STILL-VALID day are FIXED commitments: their date is the day
  // they sit on, not something we re-derive. They're excluded from the candidate pool
  // and projection of the remaining work starts the day AFTER the last persisted day.
  //
  // A SLIPPED day is the exception: its items are still `planned` (the detector only
  // flips the DAY status, never the item — invariant #5), but that work DIDN'T happen
  // and still needs doing. So we exclude `d.status = 'slipped'` here, leaving slipped
  // tasks in the candidate pool to be RE-PROJECTED forward instead of vanishing on a
  // past day. (They still appear historically on the slipped day in GET /roadmap.)
  const plannedRows = await db
    .selectFrom("daily_plan_item as i")
    .innerJoin("daily_plan_day as d", "d.id", "i.daily_plan_day_id")
    .select(["i.task_id as taskId", "d.plan_date as planDate"])
    .where("i.workspace_id", "=", ctx.workspaceId)
    .where("i.status", "=", "planned")
    .where("d.status", "<>", "slipped")
    .where("i.task_id", "is not", null)
    .execute();
  const persistedTaskDate = new Map<string, string>();
  for (const r of plannedRows) if (r.taskId) persistedTaskDate.set(r.taskId, r.planDate);

  const lastDayRow = await db
    .selectFrom("daily_plan_day")
    .select((e) => e.fn.max("plan_date").as("maxDate"))
    .where("workspace_id", "=", ctx.workspaceId)
    .executeTakeFirst();
  const lastPersisted = (lastDayRow?.maxDate as string | null) ?? null;
  const startDate =
    lastPersisted && addDays(lastPersisted, 1) > today ? addDays(lastPersisted, 1) : today;

  // --- Incomplete tasks in active projects (the work still to be scheduled). ---
  let candQ = db
    .selectFrom("task as t")
    .innerJoin("work_package as wp", "wp.id", "t.work_package_id")
    .innerJoin("project as p", "p.id", "wp.project_id")
    .select([
      "t.id as taskId",
      "p.id as projectId",
      "wp.id as workPackageId",
      "wp.milestone_id as milestoneId",
      "t.estimate_hours as estimateHours",
      "t.difficulty as difficulty",
      "t.is_time_fixed as isTimeFixed",
      "t.fixed_date as fixedDate",
      "t.position as position",
    ])
    .where("t.workspace_id", "=", ctx.workspaceId)
    .where("t.status", "=", "todo")
    .where("p.status", "=", "active")
    .where("wp.completed_at", "is", null);
  if (opts.goalId) candQ = candQ.where("p.goal_id", "=", opts.goalId);
  const rows = (await candQ.execute()) as CandidateRow[];

  // Candidates = incomplete tasks NOT already on a persisted day. They pass
  // `blocked: false` — dependency ordering is handled by `edges` (staged unblocking),
  // NOT by dropping blocked work as the near-horizon path does.
  const candidateRows = rows.filter((r) => !persistedTaskDate.has(r.taskId));
  const candidateIds = new Set(candidateRows.map((r) => r.taskId));
  const candidates = candidateRows.map((r) => ({
    taskId: r.taskId,
    projectId: r.projectId,
    hours: resolveHours(r.estimateHours != null ? Number(r.estimateHours) : null, r.difficulty),
    isTimeFixed: r.isTimeFixed,
    fixedDate: r.fixedDate,
    blocked: false,
    position: r.position,
  }));

  // --- Capacity per active project (passed to the planner as a parameter). ---
  let capQ = db
    .selectFrom("project")
    .select(["id", "capacity_hours_per_day"])
    .where("workspace_id", "=", ctx.workspaceId)
    .where("status", "=", "active");
  if (opts.goalId) capQ = capQ.where("goal_id", "=", opts.goalId);
  const capRows = await capQ.execute();
  const capacities = capRows.map((c) => ({
    projectId: c.id,
    hoursPerDay: Number(c.capacity_hours_per_day),
  }));

  // --- Dependency edges at task level, among candidate tasks only. ---
  const edges = await buildTaskEdges(db, ctx, candidateRows, candidateIds);

  const draft = planner.proposeDays({ startDate, horizonDays, candidates, capacities, edges });

  // --- Effective schedule: a persisted task keeps its committed date; the rest take
  //     their projected date. This single map feeds both milestone dates and tests. ---
  const taskDate = new Map<string, string>(persistedTaskDate);
  for (const d of draft) {
    for (const it of d.items) taskDate.set(it.taskId, d.planDate);
  }

  // projected_date(M) = latest date among M's gating tasks, or null if ANY of them
  // couldn't be placed (an unscheduled gating task makes the finish unknowable).
  const milestoneDate = new Map<string, string | null>();
  for (const r of rows) {
    if (r.milestoneId == null) continue;
    const date = taskDate.get(r.taskId) ?? null;
    if (!milestoneDate.has(r.milestoneId)) {
      milestoneDate.set(r.milestoneId, date);
      continue;
    }
    const cur = milestoneDate.get(r.milestoneId)!;
    if (cur === null || date === null) milestoneDate.set(r.milestoneId, null);
    else milestoneDate.set(r.milestoneId, date > cur ? date : cur);
  }

  return { draft, taskDate, milestoneDate };
}

/** Just the milestone→projected_date map. The shared source for flow/replan/nudges. */
export async function projectMilestoneDates(
  db: Kysely<Database>,
  ctx: WorkspaceContext,
  opts: { now?: Date; goalId?: string } = {},
): Promise<Map<string, string | null>> {
  const { milestoneDate } = await projectSchedule(db, ctx, opts);
  return milestoneDate;
}

/**
 * Task-level "must finish before" edges among the candidate set: direct
 * `task_dependency` plus `work_package_dependency` expanded m×n to task level
 * (every predecessor-WP task precedes every successor-WP task — same expansion as
 * flow.ts). Edges touching a non-candidate (completed / out-of-scope) task are
 * dropped: a completed predecessor imposes no future constraint.
 */
async function buildTaskEdges(
  db: Kysely<Database>,
  ctx: WorkspaceContext,
  candidateRows: CandidateRow[],
  candidateIds: Set<string>,
): Promise<TaskEdge[]> {
  const edges: TaskEdge[] = [];

  const taskDeps = await db
    .selectFrom("task_dependency")
    .select(["predecessor_task_id", "successor_task_id"])
    .where("workspace_id", "=", ctx.workspaceId)
    .execute();
  for (const e of taskDeps) {
    if (candidateIds.has(e.predecessor_task_id) && candidateIds.has(e.successor_task_id)) {
      edges.push({ predecessorTaskId: e.predecessor_task_id, successorTaskId: e.successor_task_id });
    }
  }

  const wpDeps = await db
    .selectFrom("work_package_dependency")
    .select(["predecessor_wp_id", "successor_wp_id"])
    .where("workspace_id", "=", ctx.workspaceId)
    .execute();
  if (wpDeps.length > 0) {
    const tasksByWp = new Map<string, string[]>();
    for (const r of candidateRows) {
      (tasksByWp.get(r.workPackageId) ?? tasksByWp.set(r.workPackageId, []).get(r.workPackageId)!).push(
        r.taskId,
      );
    }
    for (const e of wpDeps) {
      const preds = tasksByWp.get(e.predecessor_wp_id) ?? [];
      const succs = tasksByWp.get(e.successor_wp_id) ?? [];
      for (const p of preds) for (const s of succs) {
        edges.push({ predecessorTaskId: p, successorTaskId: s });
      }
    }
  }

  return edges;
}
