import { addDays } from "../../lib/dates";
import { resolveRepairLimits } from "./constants";
import { buildOutgoingMap, buildPredecessorMap } from "./graph";
import { expandStateForTaskSplitting } from "./taskSplitting";
import { validatePlanningState } from "./validatePlanningState";
import type {
  CapacityProposal,
  DateString,
  DeadlineResult,
  PlannerConfig,
  PlanningConflict,
  PlanningState,
  PlanResult,
  Task,
} from "./types";

function projectLoadKey(projectId: string, date: DateString): string {
  return `${projectId}|${date}`;
}

function daysBetween(a: DateString, b: DateString): number {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  return Math.round((db - da) / 86_400_000);
}

function taskProjectId(state: PlanningState, taskId: string): string {
  const task = state.tasks[taskId];
  if (!task) throw new Error(`Unknown task ${taskId}`);
  const wp = state.workPackages[task.workPackageId];
  if (!wp) throw new Error(`Unknown work package ${task.workPackageId}`);
  return wp.projectId;
}

function globalCapacityForDate(config: PlannerConfig, date: DateString): number {
  return config.globalCapacityHoursByDate?.[date] ?? config.globalCapacityHoursPerDay;
}

function projectCapacityForDate(
  project: { id: string; capacityHoursPerDay: number },
  config: PlannerConfig,
  date: DateString,
): number {
  return config.projectCapacityHoursByDate?.[project.id]?.[date] ?? project.capacityHoursPerDay;
}

function oldAssignmentFromPlan(state: PlanningState): Record<string, DateString> {
  const old: Record<string, DateString> = {};
  for (const [date, items] of Object.entries(state.currentPlan)) {
    for (const taskId of items) old[taskId] = date;
  }
  return old;
}

/** Project / milestone / goal completion = the latest day any of its still-open tasks lands on. */
function completionDates(
  state: PlanningState,
  assignment: Record<string, DateString>,
): {
  milestoneDates: Record<string, DateString | null>;
  projectDates: Record<string, DateString | null>;
  goalDates: Record<string, DateString | null>;
} {
  const milestoneDates: Record<string, DateString | null> = Object.fromEntries(
    Object.keys(state.milestones).map((id) => [id, null]),
  );
  const projectDates: Record<string, DateString | null> = Object.fromEntries(
    Object.keys(state.projects).map((id) => [id, null]),
  );
  const goalDates: Record<string, DateString | null> = Object.fromEntries(
    Object.keys(state.goals).map((id) => [id, null]),
  );

  for (const [taskId, task] of Object.entries(state.tasks)) {
    if (task.status === "done" || task.replacedAt) continue;
    const planned = assignment[taskId];
    if (!planned) continue;
    const wp = state.workPackages[task.workPackageId];
    if (!wp) continue;
    const project = state.projects[wp.projectId];
    if (!project) continue;

    if (!projectDates[project.id] || planned > projectDates[project.id]!) {
      projectDates[project.id] = planned;
    }
    if (!goalDates[project.goalId] || planned > goalDates[project.goalId]!) {
      goalDates[project.goalId] = planned;
    }
    if (wp.milestoneId) {
      const cur = milestoneDates[wp.milestoneId];
      if (!cur || planned > cur) milestoneDates[wp.milestoneId] = planned;
    }
  }

  return { milestoneDates, projectDates, goalDates };
}

// ---------------------------------------------------------------------------
// STEP 3 — project urgency ordering
// ---------------------------------------------------------------------------

/** Count horizon days in [from, to] (inclusive) that are not locked. */
function eligibleDayCount(
  state: PlanningState,
  config: PlannerConfig,
  from: DateString,
  toInclusive: DateString,
): number {
  let count = 0;
  for (let offset = 0; offset < config.horizonDays; offset++) {
    const day = addDays(config.today, offset);
    if (day < from) continue;
    if (day > toInclusive) break;
    if (state.dayMeta[day]?.isLocked) continue;
    count++;
  }
  return count;
}

function remainingEffortByProject(
  state: PlanningState,
  completed: Set<string>,
): Record<string, number> {
  const effort: Record<string, number> = {};
  for (const [taskId, task] of Object.entries(state.tasks)) {
    if (task.status === "done" || task.replacedAt || completed.has(taskId)) continue;
    const projectId = taskProjectId(state, taskId);
    effort[projectId] = (effort[projectId] ?? 0) + task.estimateHours;
  }
  return effort;
}

interface ProjectUrgency {
  projectId: string;
  missed: boolean;
  pressure: number;
  deadline: DateString | null;
  position: number;
}

/**
 * Deadline pressure = required_daily / normal_daily, where
 * required_daily = remaining_effort / eligible_days_before_deadline. Sort by
 * already-missed first, then pressure desc, then closest deadline, then position
 * (the "explicit project priority" proxy — there is no separate priority column).
 */
function sortProjectsByUrgency(
  state: PlanningState,
  config: PlannerConfig,
  completed: Set<string>,
): { order: string[]; pressureByProject: Record<string, number> } {
  const effort = remainingEffortByProject(state, completed);
  const urgencies: ProjectUrgency[] = Object.values(state.projects).map((project) => {
    const deadline = project.targetEndDate;
    let pressure = 0;
    let missed = false;
    if (deadline) {
      missed = deadline < config.today;
      const days = Math.max(1, eligibleDayCount(state, config, config.today, deadline));
      const requiredDaily = (effort[project.id] ?? 0) / days;
      const normalDaily = project.capacityHoursPerDay > 0 ? project.capacityHoursPerDay : 1;
      pressure = requiredDaily / normalDaily;
    }
    return { projectId: project.id, missed, pressure, deadline, position: project.position };
  });

  urgencies.sort((a, b) => {
    if (a.missed !== b.missed) return a.missed ? -1 : 1;
    if (Math.abs(a.pressure - b.pressure) > 1e-9) return b.pressure - a.pressure;
    const ad = a.deadline ?? "9999-12-31";
    const bd = b.deadline ?? "9999-12-31";
    if (ad !== bd) return ad < bd ? -1 : 1;
    if (a.position !== b.position) return a.position - b.position;
    return a.projectId < b.projectId ? -1 : 1;
  });

  const pressureByProject: Record<string, number> = {};
  for (const u of urgencies) pressureByProject[u.projectId] = u.pressure;
  return { order: urgencies.map((u) => u.projectId), pressureByProject };
}

// ---------------------------------------------------------------------------
// STEP 4 — priority-aware task queue
// ---------------------------------------------------------------------------

/** Kahn topological sort that, among ready nodes, picks the smallest by `compare`. */
function priorityTopoSort(
  nodes: string[],
  preds: Map<string, Set<string>>,
  out: Map<string, Set<string>>,
  compare: (a: string, b: string) => number,
): string[] {
  const nodeSet = new Set(nodes);
  const indeg = new Map<string, number>();
  for (const n of nodes) indeg.set(n, 0);
  for (const n of nodes) {
    for (const p of preds.get(n) ?? []) {
      if (nodeSet.has(p)) indeg.set(n, (indeg.get(n) ?? 0) + 1);
    }
  }
  const ready = nodes.filter((n) => (indeg.get(n) ?? 0) === 0);
  const placed = new Set<string>();
  const result: string[] = [];
  while (ready.length > 0) {
    ready.sort(compare);
    const n = ready.shift()!;
    if (placed.has(n)) continue;
    placed.add(n);
    result.push(n);
    for (const m of out.get(n) ?? []) {
      if (!nodeSet.has(m)) continue;
      const next = (indeg.get(m) ?? 0) - 1;
      indeg.set(m, next);
      if (next === 0) ready.push(m);
    }
  }
  // Defensive: post-validation the graph is acyclic, so this should not fire.
  for (const n of nodes) if (!placed.has(n)) result.push(n);
  return result;
}

function activeWpEffort(state: PlanningState, wpId: string): number {
  let sum = 0;
  for (const task of Object.values(state.tasks)) {
    if (task.workPackageId !== wpId) continue;
    if (task.status === "done" || task.replacedAt) continue;
    sum += task.estimateHours;
  }
  return sum;
}

/** Longest weighted downstream path from each node (critical-path importance). */
function criticalPathLengths(
  nodes: string[],
  out: Map<string, Set<string>>,
  weight: (id: string) => number,
): Map<string, number> {
  const memo = new Map<string, number>();
  const visit = (id: string): number => {
    const cached = memo.get(id);
    if (cached != null) return cached;
    let best = 0;
    for (const m of out.get(id) ?? []) best = Math.max(best, visit(m));
    const total = weight(id) + best;
    memo.set(id, total);
    return total;
  };
  for (const id of nodes) visit(id);
  return memo;
}

/** Transitive downstream node count for each node. */
function downstreamCounts(nodes: string[], out: Map<string, Set<string>>): Map<string, number> {
  const memo = new Map<string, Set<string>>();
  const visit = (id: string): Set<string> => {
    const cached = memo.get(id);
    if (cached) return cached;
    const acc = new Set<string>();
    memo.set(id, acc);
    for (const m of out.get(id) ?? []) {
      acc.add(m);
      for (const d of visit(m)) acc.add(d);
    }
    return acc;
  };
  const counts = new Map<string, number>();
  for (const id of nodes) counts.set(id, visit(id).size);
  return counts;
}

/**
 * One dependency-valid, priority-aware queue across all projects. Projects in
 * urgency order; inside a project, WPs by critical-path / downstream / position;
 * inside a WP, tasks by position. Because v1 dependencies stay intra-project, the
 * queue alone guarantees predecessor-before-successor.
 */
function buildTaskQueue(
  state: PlanningState,
  sortedProjectIds: string[],
  taskPreds: Map<string, Set<string>>,
  taskOut: Map<string, Set<string>>,
  wpPreds: Map<string, Set<string>>,
  wpOut: Map<string, Set<string>>,
  tasksByWp: Map<string, string[]>,
): string[] {
  const queue: string[] = [];
  for (const projectId of sortedProjectIds) {
    const wpIds = Object.values(state.workPackages)
      .filter((wp) => wp.projectId === projectId)
      .map((wp) => wp.id);
    if (wpIds.length === 0) continue;

    const cpl = criticalPathLengths(wpIds, wpOut, (id) => activeWpEffort(state, id));
    const dsc = downstreamCounts(wpIds, wpOut);
    const wpCompare = (a: string, b: string): number => {
      const ca = cpl.get(a) ?? 0;
      const cb = cpl.get(b) ?? 0;
      if (Math.abs(ca - cb) > 1e-9) return cb - ca;
      const da = dsc.get(a) ?? 0;
      const db = dsc.get(b) ?? 0;
      if (da !== db) return db - da;
      const pa = state.workPackages[a]?.position ?? 0;
      const pb = state.workPackages[b]?.position ?? 0;
      if (pa !== pb) return pa - pb;
      return a < b ? -1 : 1;
    };
    const orderedWps = priorityTopoSort(wpIds, wpPreds, wpOut, wpCompare);

    for (const wpId of orderedWps) {
      const taskIds = (tasksByWp.get(wpId) ?? []).filter((id) => {
        const t = state.tasks[id];
        return t && t.status !== "done" && !t.replacedAt;
      });
      if (taskIds.length === 0) continue;
      const taskCompare = (a: string, b: string): number => {
        const pa = state.tasks[a]?.position ?? 0;
        const pb = state.tasks[b]?.position ?? 0;
        if (pa !== pb) return pa - pb;
        return a < b ? -1 : 1;
      };
      for (const taskId of priorityTopoSort(taskIds, taskPreds, taskOut, taskCompare)) {
        queue.push(taskId);
      }
    }
  }
  return queue;
}

// ---------------------------------------------------------------------------
// STEP 2 — protected baseline (reserved, immovable work)
// ---------------------------------------------------------------------------

interface ProtectedBaseline {
  /** Ordered task ids per day (frozen/locked from the plan, then reserved time-fixed). */
  byDay: Record<DateString, string[]>;
  assignment: Record<string, DateString>;
  dayLoad: Record<DateString, number>;
  projectDayLoad: Record<string, number>;
  scheduled: Set<string>;
}

// ---------------------------------------------------------------------------
// STEP 6 — fill the queue against a (base + virtual) capacity envelope
// ---------------------------------------------------------------------------

interface AssignInput {
  state: PlanningState;
  config: PlannerConfig;
  queue: string[];
  taskPreds: Map<string, Set<string>>;
  wpPreds: Map<string, Set<string>>;
  tasksByWp: Map<string, string[]>;
  oldAssignment: Record<string, DateString>;
  completed: Set<string>;
  skip: Set<string>; // completed/impossible/time-fixed/handled — never queue-placed
  baseline: ProtectedBaseline;
  virtualExtraGlobal: Record<DateString, number>;
  virtualExtraProject: Record<string, Record<DateString, number>>;
}

interface AssignResult {
  assignment: Record<string, DateString>;
  dayItems: Record<DateString, string[]>;
  dayLoad: Record<DateString, number>;
  projectDayLoad: Record<string, number>;
  unplaceable: Set<string>;
}

function assignQueue(inp: AssignInput): AssignResult {
  const { state, config } = inp;
  const assignment: Record<string, DateString> = { ...inp.baseline.assignment };
  const dayItems: Record<DateString, string[]> = {};
  for (const [date, items] of Object.entries(inp.baseline.byDay)) dayItems[date] = [...items];
  const dayLoad: Record<DateString, number> = { ...inp.baseline.dayLoad };
  const projectDayLoad: Record<string, number> = { ...inp.baseline.projectDayLoad };
  const scheduled = new Set<string>(inp.baseline.scheduled);
  const unplaceable = new Set<string>();

  const effectiveGlobalCap = (date: DateString): number =>
    globalCapacityForDate(config, date) + (inp.virtualExtraGlobal[date] ?? 0);
  const effectiveProjectCap = (
    project: { id: string; capacityHoursPerDay: number },
    date: DateString,
  ): number =>
    projectCapacityForDate(project, config, date) +
    (inp.virtualExtraProject[project.id]?.[date] ?? 0);

  const floorFor = (taskId: string): DateString | null => {
    let floor = config.today;
    if (config.objective === "min_disruption") {
      const old = inp.oldAssignment[taskId];
      if (old && old >= config.today && old > floor) floor = old;
    }
    const after = (date: DateString): DateString =>
      config.sameDayDependencies ? date : addDays(date, 1);
    for (const pred of inp.taskPreds.get(taskId) ?? []) {
      if (inp.completed.has(pred)) continue;
      const pd = assignment[pred];
      if (pd == null) return null; // predecessor never placed ⇒ neither can this
      const f = after(pd);
      if (f > floor) floor = f;
    }
    const wpId = state.tasks[taskId]?.workPackageId;
    if (wpId) {
      for (const predWp of inp.wpPreds.get(wpId) ?? []) {
        for (const t of inp.tasksByWp.get(predWp) ?? []) {
          if (inp.completed.has(t)) continue;
          const pd = assignment[t];
          if (pd == null) return null;
          const f = after(pd);
          if (f > floor) floor = f;
        }
      }
    }
    return floor;
  };

  for (const taskId of inp.queue) {
    if (inp.skip.has(taskId) || scheduled.has(taskId) || assignment[taskId] != null) continue;
    const task = state.tasks[taskId] as Task | undefined;
    if (!task) continue;

    const floor = floorFor(taskId);
    if (floor == null) {
      unplaceable.add(taskId);
      continue;
    }
    const project = state.projects[taskProjectId(state, taskId)];
    if (!project) {
      unplaceable.add(taskId);
      continue;
    }

    let placed = false;
    for (let offset = 0; offset < config.horizonDays; offset++) {
      const day = addDays(config.today, offset);
      if (day < floor) continue;
      if (state.dayMeta[day]?.isLocked) continue;
      if ((dayLoad[day] ?? 0) + task.estimateHours > effectiveGlobalCap(day) + 1e-9) continue;
      const key = projectLoadKey(project.id, day);
      if ((projectDayLoad[key] ?? 0) + task.estimateHours > effectiveProjectCap(project, day) + 1e-9) {
        continue;
      }
      assignment[taskId] = day;
      (dayItems[day] ??= []).push(taskId);
      dayLoad[day] = (dayLoad[day] ?? 0) + task.estimateHours;
      projectDayLoad[key] = (projectDayLoad[key] ?? 0) + task.estimateHours;
      scheduled.add(taskId);
      placed = true;
      break;
    }
    if (!placed) unplaceable.add(taskId);
  }

  return { assignment, dayItems, dayLoad, projectDayLoad, unplaceable };
}

// ---------------------------------------------------------------------------
// planRoadmap — STEP 1..12 driver
// ---------------------------------------------------------------------------

export function planRoadmap(inputState: PlanningState, config: PlannerConfig): PlanResult {
  // STEP 1 — split oversized flexible tasks, then validate the dependency graph.
  const { expandedState: state, splitReport } = expandStateForTaskSplitting(inputState, config);
  validatePlanningState(state);

  const limits = resolveRepairLimits(config);
  const oldAssignment = oldAssignmentFromPlan(state);
  const horizonEnd = addDays(config.today, Math.max(0, config.horizonDays - 1));

  const taskEdges = state.taskDependencies.map((d) => ({
    from: d.predecessorTaskId,
    to: d.successorTaskId,
  }));
  const wpEdges = state.workPackageDependencies.map((d) => ({
    from: d.predecessorWpId,
    to: d.successorWpId,
  }));
  const taskPreds = buildPredecessorMap(taskEdges);
  const taskOut = buildOutgoingMap(taskEdges);
  const wpPreds = buildPredecessorMap(wpEdges);
  const wpOut = buildOutgoingMap(wpEdges);

  const tasksByWp = new Map<string, string[]>();
  for (const [taskId, task] of Object.entries(state.tasks)) {
    const arr = tasksByWp.get(task.workPackageId) ?? [];
    arr.push(taskId);
    tasksByWp.set(task.workPackageId, arr);
  }

  const conflicts: PlanningConflict[] = [];
  const warnings: string[] = [];

  const completed = new Set(
    Object.entries(state.tasks)
      .filter(([, task]) => task.status === "done" || task.replacedAt)
      .map(([taskId]) => taskId),
  );

  // Tasks that carry their own specific conflict; never reported as generic unscheduled.
  const handled = new Set<string>();
  // Tasks skipped by the queue filler (completed, impossible, or time-fixed/reserved).
  const skip = new Set<string>(completed);

  // --- impossible work: time-fixed without a date, or too large for one day. ---
  for (const [taskId, task] of Object.entries(state.tasks)) {
    if (task.status === "done" || task.replacedAt) continue;
    if (task.isTimeFixed && !task.fixedDate) {
      skip.add(taskId);
      handled.add(taskId);
      conflicts.push({
        type: "time_fixed_task_missing_fixed_date",
        taskId,
        taskTitle: task.title,
        reason: "Task is marked time-fixed but has no fixed date.",
        options: ["prioritize_manually", "descope", "renegotiate_date"],
      });
      continue;
    }
    const project = state.projects[taskProjectId(state, taskId)];
    const projectDailyCapacity = project?.capacityHoursPerDay ?? 0;
    const maxCap = Math.min(config.globalCapacityHoursPerDay, projectDailyCapacity);
    if (task.estimateHours > maxCap + 1e-9) {
      skip.add(taskId);
      handled.add(taskId);
      const fixed = task.isTimeFixed;
      conflicts.push({
        type: fixed
          ? "time_fixed_task_too_large_for_daily_capacity"
          : "task_too_large_for_daily_capacity",
        taskId,
        taskTitle: task.title,
        estimate_hours: task.estimateHours,
        global_capacity: config.globalCapacityHoursPerDay,
        project_capacity: projectDailyCapacity,
        fixed_date: task.fixedDate,
        suggestion: fixed
          ? "Do not auto-split this fixed-date task. Prioritize, descope, or renegotiate the date."
          : "Enable task splitting or split this task into smaller numbered tasks.",
        options: fixed ? ["prioritize", "descope", "renegotiate"] : undefined,
      });
    }
  }

  // STEP 2 — reserve protected work: frozen/locked plan items, then time-fixed tasks.
  const baseline: ProtectedBaseline = {
    byDay: {},
    assignment: {},
    dayLoad: {},
    projectDayLoad: {},
    scheduled: new Set<string>(completed),
  };
  const frozenTaskIds = new Set(state.frozenTaskIds ?? []);
  const reserve = (date: DateString, taskId: string): void => {
    const task = state.tasks[taskId];
    if (!task) return;
    const projectId = taskProjectId(state, taskId);
    baseline.assignment[taskId] = date;
    (baseline.byDay[date] ??= []).push(taskId);
    baseline.dayLoad[date] = (baseline.dayLoad[date] ?? 0) + task.estimateHours;
    const key = projectLoadKey(projectId, date);
    baseline.projectDayLoad[key] = (baseline.projectDayLoad[key] ?? 0) + task.estimateHours;
    skip.add(taskId);
  };

  const lockedOrFrozenIds = new Set<string>();
  for (const [date, items] of Object.entries(state.currentPlan)) {
    const locked = state.dayMeta[date]?.isLocked === true;
    for (const taskId of items) {
      const task = state.tasks[taskId];
      if (!task || task.status === "done" || task.replacedAt) continue;
      if (!locked && !frozenTaskIds.has(taskId)) continue;
      reserve(date, taskId);
      baseline.scheduled.add(taskId);
      lockedOrFrozenIds.add(taskId);
    }
  }

  // Reserve time-fixed tasks on their committed date (commitments win; may overflow).
  for (const [taskId, task] of Object.entries(state.tasks)) {
    if (!task.isTimeFixed || handled.has(taskId) || skip.has(taskId)) continue;
    if (task.status === "done" || task.replacedAt) continue;
    const fixedDate = task.fixedDate;
    if (!fixedDate) continue; // already flagged impossible above
    if (fixedDate < config.today) {
      skip.add(taskId);
      handled.add(taskId);
      conflicts.push({
        type: "missed_time_fixed_task",
        taskId,
        taskTitle: task.title,
        fixed_date: fixedDate,
        reason: "The fixed date passed before the task could be scheduled.",
        options: ["prioritize_today_manually", "descope", "renegotiate_date"],
      });
      continue;
    }
    if (fixedDate > horizonEnd) {
      // Can only live on its fixed date, which is past the horizon ⇒ unplaceable.
      skip.add(taskId);
      continue;
    }
    reserve(fixedDate, taskId);
    baseline.scheduled.add(taskId);
  }

  // Protected work that already busts capacity is a conflict the user must resolve.
  for (const [date, items] of Object.entries(baseline.byDay)) {
    const isLocked = state.dayMeta[date]?.isLocked === true;
    const globalCap = globalCapacityForDate(config, date);
    if ((baseline.dayLoad[date] ?? 0) > globalCap + 1e-9) {
      conflicts.push({
        type: isLocked ? "locked_day_capacity_conflict" : "frozen_day_capacity_conflict",
        date,
        reason: `Reserved work exceeds global daily capacity (${baseline.dayLoad[date]}h vs ${globalCap}h/day).`,
      });
    }
    const projectIds = new Set(items.map((taskId) => taskProjectId(state, taskId)));
    for (const projectId of projectIds) {
      const project = state.projects[projectId];
      const load = baseline.projectDayLoad[projectLoadKey(projectId, date)] ?? 0;
      if (project && load > projectCapacityForDate(project, config, date) + 1e-9) {
        conflicts.push({
          type: isLocked
            ? "locked_day_project_capacity_conflict"
            : "frozen_day_project_capacity_conflict",
          date,
          project_id: projectId,
          reason: `Reserved work exceeds project daily capacity (${load}h vs ${projectCapacityForDate(project, config, date)}h/day).`,
        });
      }
    }
  }

  // STEP 3 — order projects by deadline pressure.
  const { order: projectOrder } = sortProjectsByUrgency(state, config, completed);

  // STEP 4 — build the single dependency-valid, priority-aware task queue.
  const queue = buildTaskQueue(state, projectOrder, taskPreds, taskOut, wpPreds, wpOut, tasksByWp);

  // STEP 5 — virtual extra capacity, kept in lockstep between project and global.
  const virtualExtraGlobal: Record<DateString, number> = {};
  const virtualExtraProject: Record<string, Record<DateString, number>> = {};
  const bump = (projectId: string, date: DateString, delta: number): void => {
    virtualExtraGlobal[date] = Math.max(0, (virtualExtraGlobal[date] ?? 0) + delta);
    const perProject = (virtualExtraProject[projectId] ??= {});
    perProject[date] = Math.max(0, (perProject[date] ?? 0) + delta);
  };

  const runAssign = (): AssignResult =>
    assignQueue({
      state,
      config,
      queue,
      taskPreds,
      wpPreds,
      tasksByWp,
      oldAssignment,
      completed,
      skip,
      baseline,
      virtualExtraGlobal,
      virtualExtraProject,
    });

  const openEffort = remainingEffortByProject(state, completed);

  /** Set of projects (with a deadline) whose projection currently meets the deadline. */
  const satisfiedSet = (assignment: Record<string, DateString>): Set<string> => {
    const projectDates = completionDates(state, assignment).projectDates;
    const set = new Set<string>();
    for (const project of Object.values(state.projects)) {
      if (!project.targetEndDate || !((openEffort[project.id] ?? 0) > 0)) continue;
      const projected = projectDates[project.id] ?? null;
      if (projected != null && projected <= project.targetEndDate) set.add(project.id);
    }
    return set;
  };

  /** Highest-priority project (urgency order) with a deadline it does not currently meet. */
  const firstMissedProject = (
    assignment: Record<string, DateString>,
  ): { projectId: string; deadline: DateString } | null => {
    const projectDates = completionDates(state, assignment).projectDates;
    for (const projectId of projectOrder) {
      const project = state.projects[projectId];
      if (!project?.targetEndDate || !((openEffort[projectId] ?? 0) > 0)) continue;
      const projected = projectDates[projectId] ?? null;
      if (projected == null || projected > project.targetEndDate) {
        return { projectId, deadline: project.targetEndDate };
      }
    }
    return null;
  };

  /** STEP 10 guard: adding `step` to `date` keeps every rolling 7-day window under cap. */
  const weeklyWindowOk = (date: DateString, step: number): boolean => {
    for (let i = -6; i <= 0; i++) {
      const start = addDays(date, i);
      let sum = 0;
      for (let j = 0; j < 7; j++) {
        const d = addDays(start, j);
        sum += (virtualExtraGlobal[d] ?? 0) + (d === date ? step : 0);
      }
      if (sum > limits.maxExtraHoursPerWeek + 1e-9) return false;
    }
    return true;
  };

  /** STEP 8 — add one capacity increment for a missed project, closest to its deadline. */
  const addCapacityIncrement = (projectId: string, deadline: DateString): boolean => {
    const step = limits.capacityIncrementStep;
    const cap = deadline < horizonEnd ? deadline : horizonEnd;
    const candidates: DateString[] = [];
    for (let offset = 0; offset < config.horizonDays; offset++) {
      const day = addDays(config.today, offset);
      if (day > cap) break;
      if (state.dayMeta[day]?.isLocked) continue;
      if ((virtualExtraGlobal[day] ?? 0) + step > limits.maxExtraGlobalHoursPerDay + 1e-9) continue;
      if (!weeklyWindowOk(day, step)) continue;
      candidates.push(day);
    }
    if (candidates.length === 0) return false;
    candidates.sort((a, b) => {
      const da = daysBetween(a, deadline);
      const db = daysBetween(b, deadline);
      if (da !== db) return da - db; // closest to the deadline first
      const ea = virtualExtraGlobal[a] ?? 0;
      const eb = virtualExtraGlobal[b] ?? 0;
      if (Math.abs(ea - eb) > 1e-9) return ea - eb; // then lowest current extra
      return a < b ? -1 : 1; // then deterministic date order
    });
    bump(projectId, candidates[0]!, step);
    return true;
  };

  // STEP 6 — first fill under normal capacity; remember the "normal" projection.
  let result = runAssign();
  const normalProjectDates = completionDates(state, result.assignment).projectDates;
  let infeasibleProject: { projectId: string; deadline: DateString } | null = null;

  if (limits.maxIterations > 0 && limits.capacityIncrementStep > 0) {
    let iteration = 0;
    while (iteration < limits.maxIterations) {
      const missed = firstMissedProject(result.assignment); // STEP 7
      if (!missed) break;
      if (!addCapacityIncrement(missed.projectId, missed.deadline)) {
        infeasibleProject = missed; // STEP 10 — cannot add more within the limits
        break;
      }
      iteration += 1;
      result = runAssign(); // STEP 9 — full restart with the new envelope
    }
    if (!infeasibleProject) {
      const stillMissed = firstMissedProject(result.assignment);
      if (stillMissed) infeasibleProject = stillMissed; // ran out of iterations
    }

    // STEP 11 — trim any extra capacity that is not needed to keep deadlines met.
    const keepSatisfied = satisfiedSet(result.assignment);
    const step = limits.capacityIncrementStep;
    for (const projectId of Object.keys(virtualExtraProject).sort()) {
      const dayMap = virtualExtraProject[projectId]!;
      for (const date of Object.keys(dayMap).sort()) {
        while ((dayMap[date] ?? 0) > 1e-9) {
          bump(projectId, date, -step);
          const sat = satisfiedSet(runAssign().assignment);
          const regressed = [...keepSatisfied].some((id) => !sat.has(id));
          if (regressed) {
            bump(projectId, date, step);
            break;
          }
        }
      }
    }
    result = runAssign();
  }

  // Frozen / locked-day work that ends up ahead of its own predecessors is a
  // dependency violation the freeze created — surface it (it is never auto-moved).
  for (const taskId of [...lockedOrFrozenIds].sort()) {
    const day = result.assignment[taskId];
    if (!day) continue;
    const ready = (predDay: DateString | undefined): boolean =>
      predDay != null && (config.sameDayDependencies ? predDay <= day : predDay < day);
    let violated = false;
    for (const pred of taskPreds.get(taskId) ?? []) {
      if (completed.has(pred)) continue;
      if (!ready(result.assignment[pred])) {
        violated = true;
        break;
      }
    }
    if (!violated) {
      const wpId = state.tasks[taskId]?.workPackageId;
      for (const predWp of (wpId && wpPreds.get(wpId)) || []) {
        for (const t of tasksByWp.get(predWp) ?? []) {
          if (completed.has(t)) continue;
          if (!ready(result.assignment[t])) {
            violated = true;
            break;
          }
        }
        if (violated) break;
      }
    }
    if (violated) {
      conflicts.push({
        type: "locked_day_dependency_conflict",
        taskId,
        taskTitle: state.tasks[taskId]?.title,
        date: day,
        reason: "Task is reserved on this day, but its predecessors are not scheduled before it.",
      });
    }
  }

  // STEP 12 — assemble deadline results, capacity proposals, and conflicts.
  const dates = completionDates(state, result.assignment);
  const deadlineResults: DeadlineResult[] = [];
  for (const project of Object.values(state.projects)) {
    if (!project.targetEndDate) continue;
    const projectedDate = dates.projectDates[project.id] ?? null;
    deadlineResults.push({
      projectId: project.id,
      deadline: project.targetEndDate,
      projectedDate,
      satisfied: projectedDate != null && projectedDate <= project.targetEndDate,
    });
  }

  const capacityProposals: CapacityProposal[] = [];
  for (const projectId of projectOrder) {
    const dayMap = virtualExtraProject[projectId];
    if (!dayMap) continue;
    const entryDates = Object.keys(dayMap)
      .filter((date) => (dayMap[date] ?? 0) > 1e-9)
      .sort();
    if (entryDates.length === 0) continue;
    const project = state.projects[projectId]!;
    capacityProposals.push({
      projectId,
      deadline: project.targetEndDate,
      normalProjectedDate: normalProjectDates[projectId] ?? null,
      proposedProjectedDate: dates.projectDates[projectId] ?? null,
      requiredExtraCapacity: entryDates.map((date) => ({
        date,
        baseGlobalCapacityHours: globalCapacityForDate(config, date),
        proposedExtraGlobalHours: virtualExtraGlobal[date] ?? 0,
        baseProjectCapacityHours: projectCapacityForDate(project, config, date),
        proposedExtraProjectHours: dayMap[date] ?? 0,
      })),
    });
  }

  if (infeasibleProject) {
    const project = state.projects[infeasibleProject.projectId];
    conflicts.push({
      type: "infeasible_plan",
      project_id: infeasibleProject.projectId,
      taskTitle: project?.title,
      deadline: infeasibleProject.deadline,
      reason:
        "Could not meet the project deadline within the allowed extra-capacity limits " +
        `(max ${limits.maxExtraGlobalHoursPerDay}h/day, ${limits.maxExtraHoursPerWeek}h/week, ${limits.maxIterations} iterations).`,
    });
  }

  for (const taskId of [...result.unplaceable].sort()) {
    if (handled.has(taskId)) continue;
    const task = state.tasks[taskId];
    conflicts.push({
      type: "unscheduled_task",
      taskId,
      taskTitle: task?.title,
      reason:
        "Could not schedule within horizon under dependency, capacity, and fixed-date constraints.",
    });
  }

  const splitReportWithDates = splitReport.map((report) => ({
    ...report,
    parts: report.parts.map((part) => ({ ...part, toDate: result.assignment[part.taskId] ?? null })),
  }));

  return {
    assignment: result.assignment,
    dayItems: result.dayItems,
    dayLoad: result.dayLoad,
    projectDayLoad: result.projectDayLoad,
    conflicts,
    warnings,
    ...dates,
    splitReport: splitReportWithDates,
    expandedState: state,
    capacityProposals,
    deadlineResults,
  };
}
