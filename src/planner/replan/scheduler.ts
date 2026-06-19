import { addDays } from "../../lib/dates";
import { buildPredecessorMap } from "./graph";
import { expandStateForTaskSplitting } from "./taskSplitting";
import { validatePlanningState } from "./validatePlanningState";
import type {
  DateString,
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

function projectCapacityForDate(project: { id: string; capacityHoursPerDay: number }, config: PlannerConfig, date: DateString): number {
  return config.projectCapacityHoursByDate?.[project.id]?.[date] ?? project.capacityHoursPerDay;
}

function oldAssignmentFromPlan(state: PlanningState): Record<string, DateString> {
  const old: Record<string, DateString> = {};
  for (const [date, items] of Object.entries(state.currentPlan)) {
    for (const taskId of items) old[taskId] = date;
  }
  return old;
}

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

export function planRoadmap(inputState: PlanningState, config: PlannerConfig): PlanResult {
  const { expandedState: state, splitReport } = expandStateForTaskSplitting(inputState, config);
  validatePlanningState(state);

  const oldAssignment = oldAssignmentFromPlan(state);
  const taskPreds = buildPredecessorMap(
    state.taskDependencies.map((d) => ({ from: d.predecessorTaskId, to: d.successorTaskId })),
  );
  const wpPreds = buildPredecessorMap(
    state.workPackageDependencies.map((d) => ({ from: d.predecessorWpId, to: d.successorWpId })),
  );

  const conflicts: PlanningConflict[] = [];
  const warnings: string[] = [];
  const assignment: Record<string, DateString> = {};
  const dayItems: Record<DateString, string[]> = {};
  const dayLoad: Record<DateString, number> = {};
  const projectDayLoad: Record<string, number> = {};
  const completed = new Set(
    Object.entries(state.tasks)
      .filter(([, task]) => task.status === "done" || task.replacedAt)
      .map(([taskId]) => taskId),
  );
  const scheduled = new Set<string>(completed);
  const impossibleTasks = new Set<string>();
  const frozenByDay: Record<DateString, string[]> = {};
  const frozenTaskIds = new Set(state.frozenTaskIds ?? []);

  const addToDay = (date: DateString, taskId: string): void => {
    const task = state.tasks[taskId];
    if (!task) return;
    const projectId = taskProjectId(state, taskId);
    assignment[taskId] = date;
    (dayItems[date] ??= []).push(taskId);
    dayLoad[date] = (dayLoad[date] ?? 0) + task.estimateHours;
    const key = projectLoadKey(projectId, date);
    projectDayLoad[key] = (projectDayLoad[key] ?? 0) + task.estimateHours;
  };

  for (const [date, items] of Object.entries(state.currentPlan)) {
    const locked = state.dayMeta[date]?.isLocked === true;
    for (const taskId of items) {
      const task = state.tasks[taskId];
      if (!task || task.status === "done" || task.replacedAt) continue;
      if (!locked && !frozenTaskIds.has(taskId)) continue;
      (frozenByDay[date] ??= []).push(taskId);
      addToDay(date, taskId);
      if (date < config.today) scheduled.add(taskId);
    }
  }

  for (const [date, items] of Object.entries(dayItems)) {
    const globalCapacity = globalCapacityForDate(config, date);
    if ((dayLoad[date] ?? 0) > globalCapacity + 1e-9) {
      conflicts.push({
        type: state.dayMeta[date]?.isLocked ? "locked_day_capacity_conflict" : "frozen_day_capacity_conflict",
        date,
        reason: `Frozen work exceeds global daily capacity (${dayLoad[date]}h planned vs ${globalCapacity}h/day).`,
      });
    }
    const projectIds = new Set(items.map((taskId) => taskProjectId(state, taskId)));
    for (const projectId of projectIds) {
      const project = state.projects[projectId];
      const load = projectDayLoad[projectLoadKey(projectId, date)] ?? 0;
      if (project && load > projectCapacityForDate(project, config, date) + 1e-9) {
        conflicts.push({
          type: state.dayMeta[date]?.isLocked
            ? "locked_day_project_capacity_conflict"
            : "frozen_day_project_capacity_conflict",
          date,
          project_id: projectId,
          reason: `Frozen work exceeds project daily capacity (${load}h planned vs ${projectCapacityForDate(project, config, date)}h/day).`,
        });
      }
    }
  }

  for (const [taskId, task] of Object.entries(state.tasks)) {
    if (task.status === "done" || task.replacedAt) continue;
    if (task.isTimeFixed && !task.fixedDate) {
      impossibleTasks.add(taskId);
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
      impossibleTasks.add(taskId);
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

  const unscheduled = new Set(
    Object.entries(state.tasks)
      .filter(
        ([taskId, task]) =>
          task.status !== "done" &&
          !task.replacedAt &&
          assignment[taskId] == null &&
          !impossibleTasks.has(taskId),
      )
      .map(([taskId]) => taskId),
  );

  const allTasksInWpScheduledOrDone = (wpId: string, currentDay: DateString): boolean => {
    const taskIds = Object.entries(state.tasks)
      .filter(([, task]) => task.workPackageId === wpId && task.status !== "done" && !task.replacedAt)
      .map(([taskId]) => taskId)
      .filter((taskId) => !impossibleTasks.has(taskId));

    return taskIds.every((taskId) => {
      if (!scheduled.has(taskId)) return false;
      if (!config.sameDayDependencies && assignment[taskId] === currentDay) return false;
      return true;
    });
  };

  const dependenciesReady = (taskId: string, currentDay: DateString): boolean => {
    const task = state.tasks[taskId];
    if (!task) return false;
    for (const pred of taskPreds.get(taskId) ?? []) {
      if (!scheduled.has(pred)) return false;
      if (!config.sameDayDependencies && assignment[pred] === currentDay) return false;
    }
    for (const predWp of wpPreds.get(task.workPackageId) ?? []) {
      if (!allTasksInWpScheduledOrDone(predWp, currentDay)) return false;
    }
    return true;
  };

  const earliestAllowedDate = (taskId: string): DateString => {
    const task = state.tasks[taskId]!;
    if (task.isTimeFixed && task.fixedDate) return task.fixedDate;
    if (config.objective === "min_disruption") {
      const old = oldAssignment[taskId];
      if (old && old >= config.today) return old;
    }
    return config.today;
  };

  const rankTask = (taskId: string, currentDay: DateString): (string | number)[] => {
    const task = state.tasks[taskId]!;
    const wp = state.workPackages[task.workPackageId]!;
    const project = state.projects[wp.projectId]!;
    const old = oldAssignment[taskId];
    const isFixedToday = task.isTimeFixed && task.fixedDate === currentDay ? 1 : 0;
    const wasPlannedToday = old === currentDay ? 1 : 0;
    const isOverdueFromOldPlan = old != null && old < config.today ? 1 : 0;
    const isNewTask = old == null ? 1 : 0;
    const fixedPressure = task.fixedDate ? daysBetween(currentDay, task.fixedDate) : 9999;
    const oldDelta = old ? Math.abs(daysBetween(old, currentDay)) : 9999;
    return [
      -isFixedToday,
      -wasPlannedToday,
      -isOverdueFromOldPlan,
      fixedPressure,
      project.priority,
      task.priority,
      oldDelta,
      project.position,
      wp.position,
      task.position,
      -isNewTask,
      taskId,
    ];
  };

  const compareRank = (a: string, b: string, day: DateString): number => {
    const ra = rankTask(a, day);
    const rb = rankTask(b, day);
    for (let i = 0; i < ra.length; i++) {
      const av = ra[i]!;
      const bv = rb[i]!;
      if (av < bv) return -1;
      if (av > bv) return 1;
    }
    return 0;
  };

  for (let offset = 0; offset < config.horizonDays; offset++) {
    const currentDay = addDays(config.today, offset);

    for (const taskId of frozenByDay[currentDay] ?? []) {
      if (!dependenciesReady(taskId, currentDay)) {
        conflicts.push({
          type: "locked_day_dependency_conflict",
          taskId,
          taskTitle: state.tasks[taskId]?.title,
          date: currentDay,
          reason: "Task is frozen on this day, but its predecessors are not scheduled before it.",
        });
      }
      scheduled.add(taskId);
    }

    if (state.dayMeta[currentDay]?.isLocked) {
      if (unscheduled.size === 0) break;
      continue;
    }

    let madeProgress = true;
    while (madeProgress) {
      madeProgress = false;
      const candidates: string[] = [];

      for (const taskId of [...unscheduled]) {
        const task = state.tasks[taskId] as Task | undefined;
        if (!task) continue;

        if (task.isTimeFixed) {
          if (task.fixedDate && task.fixedDate < currentDay) {
            conflicts.push({
              type: "missed_time_fixed_task",
              taskId,
              taskTitle: task.title,
              fixed_date: task.fixedDate,
              reason: "The fixed date passed before the task could be scheduled.",
              options: ["prioritize_today_manually", "descope", "renegotiate_date"],
            });
            unscheduled.delete(taskId);
            continue;
          }
          if (task.fixedDate !== currentDay) continue;
        }

        if (currentDay < earliestAllowedDate(taskId)) continue;
        if (!dependenciesReady(taskId, currentDay)) continue;

        const project = state.projects[taskProjectId(state, taskId)];
        if (!project) continue;
        if ((dayLoad[currentDay] ?? 0) + task.estimateHours > globalCapacityForDate(config, currentDay) + 1e-9) {
          continue;
        }
        const key = projectLoadKey(project.id, currentDay);
        if ((projectDayLoad[key] ?? 0) + task.estimateHours > projectCapacityForDate(project, config, currentDay) + 1e-9) {
          continue;
        }

        candidates.push(taskId);
      }

      if (candidates.length === 0) break;
      candidates.sort((a, b) => compareRank(a, b, currentDay));
      const chosen = candidates[0]!;
      addToDay(currentDay, chosen);
      scheduled.add(chosen);
      unscheduled.delete(chosen);
      madeProgress = true;
    }

    if (unscheduled.size === 0) break;
  }

  for (const taskId of [...unscheduled].sort()) {
    const task = state.tasks[taskId];
    conflicts.push({
      type: "unscheduled_task",
      taskId,
      taskTitle: task?.title,
      reason: "Could not schedule within horizon under dependency, capacity, and fixed-date constraints.",
    });
  }

  const dates = completionDates(state, assignment);
  const splitReportWithDates = splitReport.map((report) => ({
    ...report,
    parts: report.parts.map((part) => ({ ...part, toDate: assignment[part.taskId] ?? null })),
  }));

  return {
    assignment,
    dayItems,
    dayLoad,
    projectDayLoad,
    conflicts,
    warnings,
    ...dates,
    splitReport: splitReportWithDates,
    expandedState: state,
  };
}
