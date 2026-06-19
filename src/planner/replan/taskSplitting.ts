import type { PlannerConfig, PlanningState, Task, TaskDependency, TaskSplitReport } from "./types";

export function computeSplitSizes(totalHours: number, maxChunkHours: number): number[] {
  if (maxChunkHours <= 0) throw new Error("maxChunkHours must be positive.");
  const sizes: number[] = [];
  let remaining = Number(totalHours.toFixed(6));
  while (remaining > maxChunkHours + 1e-9) {
    sizes.push(Number(maxChunkHours.toFixed(2)));
    remaining = Number((remaining - maxChunkHours).toFixed(6));
  }
  if (remaining > 1e-9) sizes.push(Number(remaining.toFixed(2)));
  return sizes;
}

function cloneState(state: PlanningState): PlanningState {
  return {
    goals: Object.fromEntries(Object.entries(state.goals).map(([k, v]) => [k, { ...v }])),
    projects: Object.fromEntries(Object.entries(state.projects).map(([k, v]) => [k, { ...v }])),
    milestones: Object.fromEntries(Object.entries(state.milestones).map(([k, v]) => [k, { ...v }])),
    workPackages: Object.fromEntries(
      Object.entries(state.workPackages).map(([k, v]) => [k, { ...v }]),
    ),
    tasks: Object.fromEntries(Object.entries(state.tasks).map(([k, v]) => [k, { ...v }])),
    taskDependencies: state.taskDependencies.map((d) => ({ ...d })),
    workPackageDependencies: state.workPackageDependencies.map((d) => ({ ...d })),
    currentPlan: Object.fromEntries(
      Object.entries(state.currentPlan).map(([date, items]) => [date, [...items]]),
    ),
    dayMeta: Object.fromEntries(Object.entries(state.dayMeta).map(([k, v]) => [k, { ...v }])),
    frozenTaskIds: state.frozenTaskIds ? [...state.frozenTaskIds] : undefined,
  };
}

function taskProjectId(state: PlanningState, taskId: string): string {
  const task = state.tasks[taskId];
  if (!task) throw new Error(`Unknown task ${taskId}`);
  const wp = state.workPackages[task.workPackageId];
  if (!wp) throw new Error(`Unknown work package ${task.workPackageId}`);
  return wp.projectId;
}

function taskIsOnLockedDay(state: PlanningState, taskId: string): boolean {
  for (const [date, items] of Object.entries(state.currentPlan)) {
    if (items.includes(taskId) && state.dayMeta[date]?.isLocked) return true;
  }
  return false;
}

export function expandStateForTaskSplitting(
  state: PlanningState,
  config: PlannerConfig,
): { expandedState: PlanningState; splitReport: TaskSplitReport[] } {
  if (!config.allowTaskSplitting) {
    return { expandedState: cloneState(state), splitReport: [] };
  }

  const expanded = cloneState(state);
  const splitReport: TaskSplitReport[] = [];
  const splitParts = new Map<string, string[]>();
  const frozen = new Set(state.frozenTaskIds ?? []);
  const newTasks: Record<string, Task> = {};

  for (const [taskId, task] of Object.entries(state.tasks)) {
    const project = state.projects[taskProjectId(state, taskId)];
    if (!project) throw new Error(`Unknown project for task ${taskId}`);
    let maxChunk = Math.min(config.globalCapacityHoursPerDay, project.capacityHoursPerDay);
    if (config.splitChunkHours != null) maxChunk = Math.min(maxChunk, config.splitChunkHours);

    const shouldSplit =
      task.status !== "done" &&
      !task.isTimeFixed &&
      !task.isSplitPart &&
      !task.replacedAt &&
      !frozen.has(taskId) &&
      !taskIsOnLockedDay(state, taskId) &&
      task.estimateHours > maxChunk + 1e-9;

    if (!shouldSplit) {
      newTasks[taskId] = { ...task };
      continue;
    }

    const sizes = computeSplitSizes(task.estimateHours, maxChunk);
    const partIds: string[] = [];
    for (let i = 0; i < sizes.length; i++) {
      const idx = i + 1;
      const partId = `${taskId}__part_${idx}`;
      const part: Task = {
        ...task,
        id: partId,
        title: `${task.title} ${idx}/${sizes.length}`,
        estimateHours: sizes[i]!,
        isTimeFixed: false,
        fixedDate: null,
        originalTaskId: taskId,
        splitIndex: idx,
        splitCount: sizes.length,
        isSplitPart: true,
        replacedAt: null,
        position: task.position * 1000 + idx,
      };
      newTasks[partId] = part;
      partIds.push(partId);
    }

    splitParts.set(taskId, partIds);
    splitReport.push({
      originalTaskId: taskId,
      originalTitle: task.title,
      originalHours: task.estimateHours,
      maxChunkHours: maxChunk,
      splitCount: partIds.length,
      parts: partIds.map((partId) => ({
        taskId: partId,
        title: newTasks[partId]!.title,
        hours: newTasks[partId]!.estimateHours,
      })),
    });
  }

  expanded.tasks = newTasks;

  const firstPartOrSelf = (taskId: string) => splitParts.get(taskId)?.[0] ?? taskId;
  const lastPartOrSelf = (taskId: string) => {
    const parts = splitParts.get(taskId);
    return parts ? parts[parts.length - 1]! : taskId;
  };

  const deps: TaskDependency[] = [];
  for (const dep of state.taskDependencies) {
    deps.push({
      predecessorTaskId: lastPartOrSelf(dep.predecessorTaskId),
      successorTaskId: firstPartOrSelf(dep.successorTaskId),
    });
  }
  for (const parts of splitParts.values()) {
    for (let i = 0; i < parts.length - 1; i++) {
      deps.push({ predecessorTaskId: parts[i]!, successorTaskId: parts[i + 1]! });
    }
  }

  const seen = new Set<string>();
  expanded.taskDependencies = deps.filter((dep) => {
    const key = `${dep.predecessorTaskId}->${dep.successorTaskId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  expanded.currentPlan = {};
  for (const [date, items] of Object.entries(state.currentPlan)) {
    expanded.currentPlan[date] = [];
    for (const taskId of items) {
      const parts = splitParts.get(taskId);
      if (parts) expanded.currentPlan[date]!.push(...parts);
      else expanded.currentPlan[date]!.push(taskId);
    }
  }

  expanded.frozenTaskIds = (state.frozenTaskIds ?? []).flatMap((taskId) => splitParts.get(taskId) ?? [taskId]);

  return { expandedState: expanded, splitReport };
}
