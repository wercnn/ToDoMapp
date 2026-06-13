/**
 * Replan ANALYZE — the diff producer (api §11, foundation §4.4 detect→analyze).
 *
 * Lives here, a sibling domain module, NOT inside the planner: diffing needs the
 * *current persisted plan* and time-fixed/locked/blocked state — all I/O — while
 * the planner interface stays a pure function (Decision #19). replan is a consumer
 * of `proposeDays` exactly as the roadmap service is: assemble a prospective input,
 * call the pure planner for the TARGET schedule, then diff it against the baseline.
 *
 * Structural guarantee enforced here: `computeDiff` NEVER emits a time-fixed task
 * into `moves`. Time-fixed work is pinned by the planner (from == to) and any
 * capacity collision is surfaced separately in `time_fixed_conflicts`.
 */
import type { Executor } from "../../db/transaction";
import type { WorkspaceContext } from "../../auth/context";
import { addDays, localDate } from "../../lib/dates";
import { planner } from "../../planner/index";
import type { DraftDay } from "../../planner/types";
import { resolveHours } from "../../planner/constants";
import { getBlockedTaskIds } from "../blocked";
import { projectMilestoneDates } from "../projection";
import type { Changes, MilestoneImpact, Move, TimeFixedConflict } from "./types";
import { emptyChanges } from "./types";

const DEFAULT_HORIZON_DAYS = 7;

export interface ReplanScope {
  project_id?: string;
  from_date?: string;
}

export interface AnalyzeOptions {
  scope?: ReplanScope;
  horizonDays?: number;
  now?: Date;
}

/** A currently-planned item (the diff baseline): which day a task sits on today. */
export interface BaselineItem {
  taskId: string;
  planDate: string;
}

/**
 * PURE diff: baseline (current planned items) vs target (planner output). Time-fixed
 * tasks are never emitted as moves — they are pinned, and collisions are reported by
 * the caller in `time_fixed_conflicts`. Exported for unit testing.
 */
export function computeDiff(
  baseline: BaselineItem[],
  target: DraftDay[],
  timeFixedTaskIds: Set<string>,
): Move[] {
  const fromByTask = new Map<string, string>();
  for (const b of baseline) fromByTask.set(b.taskId, b.planDate);

  const toByTask = new Map<string, string>();
  for (const day of target) {
    for (const it of day.items) toByTask.set(it.taskId, day.planDate);
  }

  const moves: Move[] = [];
  const taskIds = new Set<string>([...fromByTask.keys(), ...toByTask.keys()]);
  for (const taskId of taskIds) {
    if (timeFixedTaskIds.has(taskId)) continue; // pinned — never a move (the guarantee)
    const from = fromByTask.get(taskId) ?? null;
    const to = toByTask.get(taskId) ?? null;
    if (from === to) continue; // unchanged
    moves.push({ task_id: taskId, from_date: from, to_date: to });
  }
  // Stable order for a readable, deterministic diff.
  moves.sort((a, b) => (a.task_id < b.task_id ? -1 : a.task_id > b.task_id ? 1 : 0));
  return moves;
}

function summarize(changes: Changes): string {
  const m = changes.moves.length;
  const tf = changes.time_fixed_conflicts.length;
  const ms = changes.milestone_impacts.length;
  if (m === 0 && tf === 0 && ms === 0) {
    return "No roadmap changes needed.";
  }
  const parts: string[] = [];
  if (m > 0) parts.push(`Move ${m} task${m === 1 ? "" : "s"}`);
  if (ms > 0) parts.push(`${ms} milestone${ms === 1 ? "" : "s"} shift`);
  if (tf > 0) parts.push(`${tf} time-fixed conflict${tf === 1 ? "" : "s"} need a decision`);
  return parts.join("; ") + ".";
}

/**
 * Produce a `{ summary, changes }` diff for the current workspace state. Reads only
 * (accepts any Executor so it can run inside the WP-create transaction for the
 * `new_work_package` trigger). Trigger-agnostic — the Phase 5 slippage job calls the
 * same path with `trigger='slippage'`.
 */
export async function analyzeReplan(
  db: Executor,
  ctx: WorkspaceContext,
  opts: AnalyzeOptions = {},
): Promise<{ summary: string; changes: Changes }> {
  const now = opts.now ?? new Date();
  const startDate = opts.scope?.from_date ?? localDate(ctx.timezone, now);
  const horizonDays = opts.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const endDate = addDays(startDate, horizonDays - 1);
  const projectFilter = opts.scope?.project_id;

  // --- Candidate tasks: open todo work in active projects. ---
  let candQ = db
    .selectFrom("task as t")
    .innerJoin("work_package as wp", "wp.id", "t.work_package_id")
    .innerJoin("project as p", "p.id", "wp.project_id")
    .select([
      "t.id as taskId",
      "p.id as projectId",
      "t.estimate_hours as estimateHours",
      "t.difficulty as difficulty",
      "t.is_time_fixed as isTimeFixed",
      "t.fixed_date as fixedDate",
      "t.position as position",
      "wp.milestone_id as milestoneId",
    ])
    .where("t.workspace_id", "=", ctx.workspaceId)
    .where("t.status", "=", "todo")
    .where("p.status", "=", "active")
    .where("wp.completed_at", "is", null);
  if (projectFilter) candQ = candQ.where("p.id", "=", projectFilter);
  const rows = await candQ.execute();

  // Tasks pinned on LOCKED days are untouchable — exclude from candidates so the
  // planner never reschedules them (invariant: locked days never proposed against).
  const lockedRows = await db
    .selectFrom("daily_plan_item as dpi")
    .innerJoin("daily_plan_day as d", "d.id", "dpi.daily_plan_day_id")
    .select("dpi.task_id as taskId")
    .where("dpi.workspace_id", "=", ctx.workspaceId)
    .where("dpi.status", "=", "planned")
    .where("dpi.task_id", "is not", null)
    .where("d.is_locked", "=", true)
    .execute();
  const lockedTaskIds = new Set(lockedRows.map((r) => r.taskId));

  const blocked = await getBlockedTaskIds(db, ctx);

  const candidates = rows
    .filter((r) => !lockedTaskIds.has(r.taskId))
    .map((r) => ({
      taskId: r.taskId,
      projectId: r.projectId,
      hours: resolveHours(r.estimateHours != null ? Number(r.estimateHours) : null, r.difficulty),
      isTimeFixed: r.isTimeFixed,
      fixedDate: r.fixedDate,
      blocked: blocked.has(r.taskId),
      position: r.position,
    }));

  // --- Capacity (read here, passed to the pure planner as a parameter). ---
  let capQ = db
    .selectFrom("project")
    .select(["id", "capacity_hours_per_day"])
    .where("workspace_id", "=", ctx.workspaceId)
    .where("status", "=", "active");
  if (projectFilter) capQ = capQ.where("id", "=", projectFilter);
  const capRows = await capQ.execute();
  const capacities = capRows.map((c) => ({
    projectId: c.id,
    hoursPerDay: Number(c.capacity_hours_per_day),
  }));
  const capByProject = new Map(capacities.map((c) => [c.projectId, c.hoursPerDay]));

  const target = planner.proposeDays({ startDate, horizonDays, candidates, capacities });

  // --- Baseline: planned items on UNLOCKED days in the window (what may move). ---
  let baseQ = db
    .selectFrom("daily_plan_item as dpi")
    .innerJoin("daily_plan_day as d", "d.id", "dpi.daily_plan_day_id")
    .innerJoin("task as t", "t.id", "dpi.task_id")
    .innerJoin("work_package as wp", "wp.id", "t.work_package_id")
    .select(["dpi.task_id as taskId", "d.plan_date as planDate", "wp.project_id as projectId"])
    .where("dpi.workspace_id", "=", ctx.workspaceId)
    .where("dpi.status", "=", "planned")
    .where("dpi.task_id", "is not", null)
    .where("d.is_locked", "=", false)
    .where("d.plan_date", ">=", startDate)
    .where("d.plan_date", "<=", endDate);
  if (projectFilter) baseQ = baseQ.where("wp.project_id", "=", projectFilter);
  const baseRows = await baseQ.execute();
  const baseline: BaselineItem[] = baseRows
    .filter((r): r is typeof r & { taskId: string } => r.taskId !== null)
    .map((r) => ({ taskId: r.taskId, planDate: r.planDate }));

  const timeFixedTaskIds = new Set(rows.filter((r) => r.isTimeFixed).map((r) => r.taskId));
  const moves = computeDiff(baseline, target, timeFixedTaskIds);

  // --- Time-fixed conflicts: a pinned task whose fixed date is over capacity. ---
  const usageByDateProject = new Map<string, number>();
  const hoursByTask = new Map(candidates.map((c) => [c.taskId, c.hours]));
  for (const day of target) {
    for (const it of day.items) {
      const key = `${day.planDate}|${it.projectId}`;
      usageByDateProject.set(key, (usageByDateProject.get(key) ?? 0) + (hoursByTask.get(it.taskId) ?? 0));
    }
  }
  const time_fixed_conflicts: TimeFixedConflict[] = [];
  for (const c of candidates) {
    if (!c.isTimeFixed || !c.fixedDate || c.blocked) continue;
    const cap = capByProject.get(c.projectId) ?? 0;
    const usage = usageByDateProject.get(`${c.fixedDate}|${c.projectId}`) ?? 0;
    if (usage > cap) {
      time_fixed_conflicts.push({
        task_id: c.taskId,
        fixed_date: c.fixedDate,
        reason: `Fixed date ${c.fixedDate} is over capacity (${usage}h planned vs ${cap}h/day).`,
        options: ["prioritize", "descope", "renegotiate"],
      });
    }
  }

  // --- Milestone impacts. `from` = the milestone's latest currently-PLANNED date
  // (the present plan); `to` = its projected_date from the SHARED projection helper
  // (data-model §6, computed live, never stored). Using the canonical projection —
  // not a window-local heuristic — means the date a replan shows for a milestone is
  // the SAME one GET /roadmap and the flow diagram show (they all call this helper).
  const milestoneByTask = new Map(rows.map((r) => [r.taskId, r.milestoneId]));
  const fromMs = new Map<string, string>();
  const bump = (m: Map<string, string>, ms: string | null, date: string) => {
    if (!ms) return;
    const cur = m.get(ms);
    if (!cur || date > cur) m.set(ms, date);
  };
  for (const b of baseline) bump(fromMs, milestoneByTask.get(b.taskId) ?? null, b.planDate);

  const projectedDates = await projectMilestoneDates(db, ctx, { now });
  const impactedMs = new Set<string>([...fromMs.keys(), ...projectedDates.keys()]);
  const milestone_impacts: MilestoneImpact[] = [];
  if (impactedMs.size > 0) {
    const titles = await db
      .selectFrom("milestone")
      .select(["id", "title"])
      .where("workspace_id", "=", ctx.workspaceId)
      .where("id", "in", [...impactedMs])
      .execute();
    const titleById = new Map(titles.map((t) => [t.id, t.title]));
    for (const ms of impactedMs) {
      const from = fromMs.get(ms) ?? null;
      const to = projectedDates.get(ms) ?? null;
      if (from === to) continue;
      milestone_impacts.push({
        milestone_id: ms,
        title: titleById.get(ms) ?? "",
        from_projected_date: from,
        to_projected_date: to,
      });
    }
  }

  const changes: Changes = { ...emptyChanges(), moves, milestone_impacts, time_fixed_conflicts };
  return { summary: summarize(changes), changes };
}
