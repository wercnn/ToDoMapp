import type {
  DateString,
  PlanResult,
  PlanningState,
  ReplanCapacityProposal,
  ReplanDeadlineResult,
  ReplanGoalImpact,
  ReplanInsertion,
  ReplanMilestoneImpact,
  ReplanMove,
  ReplanProposalDiff,
  ReplanRemovedOrUnplanned,
  Task,
  PlanningConflict,
} from "./types";

function daysBetween(a: DateString, b: DateString): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
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
  goalDates: Record<string, DateString | null>;
} {
  const milestoneDates: Record<string, DateString | null> = Object.fromEntries(
    Object.keys(state.milestones).map((id) => [id, null]),
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
    if (wp.milestoneId) {
      const cur = milestoneDates[wp.milestoneId];
      if (!cur || planned > cur) milestoneDates[wp.milestoneId] = planned;
    }
    const curGoal = goalDates[project.goalId];
    if (!curGoal || planned > curGoal) goalDates[project.goalId] = planned;
  }
  return { milestoneDates, goalDates };
}

function common(taskId: string, task: Task) {
  return {
    task_id: taskId,
    task_title: task.title,
    original_task_id: task.originalTaskId,
    split_index: task.splitIndex,
    split_count: task.splitCount,
  };
}

function normalizeConflict(conflict: PlanningConflict): PlanningConflict {
  const out = { ...conflict };
  if (typeof out.taskId === "string" && out.task_id == null) out.task_id = out.taskId;
  if (typeof out.taskTitle === "string" && out.task_title == null) out.task_title = out.taskTitle;
  delete out.taskId;
  delete out.taskTitle;
  return out;
}

export function createProposalDiff(
  originalState: PlanningState,
  planResult: PlanResult,
): ReplanProposalDiff {
  const state = planResult.expandedState;
  const originalOldAssignment = oldAssignmentFromPlan(originalState);
  const movesOnly: ReplanMove[] = [];
  const insertions: ReplanInsertion[] = [];
  const removedOrUnplanned: ReplanRemovedOrUnplanned[] = [];
  const unchanged: string[] = [];
  const splitOriginalIds = new Set(planResult.splitReport.map((r) => r.originalTaskId));

  for (const [taskId, task] of Object.entries(state.tasks)) {
    if (task.status === "done" || task.replacedAt) continue;
    const old = task.isSplitPart ? undefined : originalOldAssignment[taskId];
    const next = planResult.assignment[taskId];
    const base = common(taskId, task);

    if (old && next) {
      if (old === next) unchanged.push(taskId);
      else {
        movesOnly.push({
          ...base,
          from_date: old,
          to_date: next,
          delta_days: daysBetween(old, next),
        });
      }
    } else if (!old && next) {
      insertions.push({ ...base, to_date: next });
    } else if (old && !next) {
      removedOrUnplanned.push({ ...base, from_date: old });
    }
  }

  for (const originalTaskId of splitOriginalIds) {
    const old = originalOldAssignment[originalTaskId];
    const originalTask = originalState.tasks[originalTaskId];
    if (old && originalTask) {
      removedOrUnplanned.push({
        task_id: originalTaskId,
        task_title: originalTask.title,
        original_task_id: null,
        split_index: null,
        split_count: null,
        from_date: old,
      });
    }
  }

  const oldDates = completionDates(originalState, originalOldAssignment);
  const milestoneImpacts: ReplanMilestoneImpact[] = [];
  for (const [milestoneId, milestone] of Object.entries(state.milestones)) {
    const old = oldDates.milestoneDates[milestoneId] ?? null;
    const next = planResult.milestoneDates[milestoneId] ?? null;
    if (old === next) continue;
    milestoneImpacts.push({
      milestone_id: milestoneId,
      title: milestone.title,
      from_projected_date: old,
      to_projected_date: next,
      delta_days: old && next ? daysBetween(old, next) : null,
    });
  }

  const goalImpacts: ReplanGoalImpact[] = [];
  for (const [goalId, goal] of Object.entries(state.goals)) {
    const old = oldDates.goalDates[goalId] ?? null;
    const next = planResult.goalDates[goalId] ?? null;
    if (old === next) continue;
    goalImpacts.push({
      goal_id: goalId,
      title: goal.title,
      from_projected_date: old,
      to_projected_date: next,
      delta_days: old && next ? daysBetween(old, next) : null,
    });
  }

  const insertionMoves: ReplanMove[] = insertions.map((i) => ({
    task_id: i.task_id,
    task_title: i.task_title,
    original_task_id: i.original_task_id,
    split_index: i.split_index,
    split_count: i.split_count,
    from_date: null,
    to_date: i.to_date,
  }));
  const removalMoves: ReplanMove[] = removedOrUnplanned
    .filter((r) => !splitOriginalIds.has(r.task_id))
    .map((r) => ({
      task_id: r.task_id,
      task_title: r.task_title,
      original_task_id: r.original_task_id,
      split_index: r.split_index,
      split_count: r.split_count,
      from_date: r.from_date,
      to_date: null,
    }));

  const timeFixedConflicts = planResult.conflicts
    .filter((c) => String(c.type).includes("time_fixed"))
    .map((c) => normalizeConflict(c));
  const planningConflicts = planResult.conflicts
    .filter((c) => !String(c.type).includes("time_fixed"))
    .map((c) => normalizeConflict(c));
  const moves = [...movesOnly, ...insertionMoves, ...removalMoves].sort((a, b) =>
    a.task_id < b.task_id ? -1 : a.task_id > b.task_id ? 1 : 0,
  );

  const capacity_proposals: ReplanCapacityProposal[] = planResult.capacityProposals.map((p) => ({
    project_id: p.projectId,
    deadline: p.deadline,
    normal_projected_date: p.normalProjectedDate,
    proposed_projected_date: p.proposedProjectedDate,
    required_extra_capacity: p.requiredExtraCapacity.map((d) => ({
      date: d.date,
      base_global_capacity_hours: d.baseGlobalCapacityHours,
      proposed_extra_global_hours: d.proposedExtraGlobalHours,
      base_project_capacity_hours: d.baseProjectCapacityHours,
      proposed_extra_project_hours: d.proposedExtraProjectHours,
    })),
  }));

  const deadline_results: ReplanDeadlineResult[] = planResult.deadlineResults.map((r) => ({
    project_id: r.projectId,
    deadline: r.deadline,
    projected_date: r.projectedDate,
    satisfied: r.satisfied,
  }));

  const capacitySuffix =
    capacity_proposals.length > 0 ? ` ${capacity_proposals.length} capacity proposal(s).` : "";
  const summary =
    `${movesOnly.length} moved, ` +
    `${insertions.length} inserted, ` +
    `${unchanged.length} unchanged, ` +
    `${removedOrUnplanned.length} unplanned/removed, ` +
    `${planResult.conflicts.length} conflicts, ` +
    `${planResult.splitReport.length} tasks split.` +
    capacitySuffix;

  return {
    summary,
    moves,
    milestone_impacts: milestoneImpacts,
    time_fixed_conflicts: timeFixedConflicts,
    insertions,
    removed_or_unplanned: removedOrUnplanned,
    unchanged_task_ids: unchanged,
    goal_impacts: goalImpacts,
    planning_conflicts: planningConflicts,
    warnings: planResult.warnings,
    split_report: planResult.splitReport,
    capacity_proposals,
    deadline_results,
  };
}
