/**
 * Replan ANALYZE — DB state → pure planning state → stored proposal diff.
 *
 * Proposal generation remains read-only: it loads the current roadmap/WBS, runs
 * the pure `src/planner/replan` engine, and returns JSONB changes. Relational
 * truth only changes in approve/apply.
 */
import type { Executor } from "../../db/transaction";
import type { WorkspaceContext } from "../../auth/context";
import { localDate } from "../../lib/dates";
import { resolveHours } from "../../planner/constants";
import { createProposalDiff, planRoadmap } from "../../planner/replan";
import type {
  PlannerConfig,
  PlanningState,
  ReplanProposalDiff,
  TaskSplitReport,
} from "../../planner/replan";
import type { DraftDay } from "../../planner/types";
import type { Changes, MilestoneImpact, Move } from "./types";

const DEFAULT_HORIZON_DAYS = 120;

export interface ReplanScope {
  project_id?: string;
  from_date?: string;
}

export interface AnalyzeOptions {
  scope?: ReplanScope;
  horizonDays?: number;
  now?: Date;
  allowTaskSplitting?: boolean;
  splitChunkHours?: number | null;
}

/** A currently-planned item (the diff baseline): which day a task sits on today. */
export interface BaselineItem {
  taskId: string;
  planDate: string;
}

/**
 * PURE legacy diff helper retained for existing unit tests and callers. Time-fixed
 * tasks are never emitted as moves.
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
    if (timeFixedTaskIds.has(taskId)) continue;
    const from = fromByTask.get(taskId) ?? null;
    const to = toByTask.get(taskId) ?? null;
    if (from === to) continue;
    moves.push({ task_id: taskId, from_date: from, to_date: to });
  }
  moves.sort((a, b) => (a.task_id < b.task_id ? -1 : a.task_id > b.task_id ? 1 : 0));
  return moves;
}

function summarize(changes: Changes): string {
  const moves = changes.moves.length;
  const conflicts = (changes.time_fixed_conflicts?.length ?? 0) + (changes.planning_conflicts?.length ?? 0);
  const splits = changes.split_report?.length ?? 0;
  const milestones = changes.milestone_impacts.length;
  if (moves === 0 && conflicts === 0 && splits === 0 && milestones === 0) {
    return "No roadmap changes needed.";
  }
  const parts: string[] = [];
  if (moves > 0) parts.push(`Move ${moves} task${moves === 1 ? "" : "s"}`);
  if (splits > 0) parts.push(`split ${splits} task${splits === 1 ? "" : "s"}`);
  if (milestones > 0) parts.push(`${milestones} milestone${milestones === 1 ? "" : "s"} shift`);
  if (conflicts > 0) parts.push(`${conflicts} conflict${conflicts === 1 ? "" : "s"} need review`);
  return parts.join("; ") + ".";
}

function splitReportToJson(report: TaskSplitReport[]): NonNullable<Changes["split_report"]> {
  return report.map((r) => ({
    original_task_id: r.originalTaskId,
    original_title: r.originalTitle,
    original_hours: r.originalHours,
    max_chunk_hours: r.maxChunkHours,
    split_count: r.splitCount,
    parts: r.parts.map((p) => ({
      task_id: p.taskId,
      title: p.title,
      hours: p.hours,
      to_date: p.toDate ?? null,
    })),
  }));
}

function plannerDiffToChanges(diff: ReplanProposalDiff): Changes {
  const milestone_impacts: MilestoneImpact[] = diff.milestone_impacts.map((m) => ({
    milestone_id: m.milestone_id,
    title: m.title,
    from_projected_date: m.from_projected_date,
    to_projected_date: m.to_projected_date,
  }));
  return {
    moves: diff.moves,
    milestone_impacts,
    time_fixed_conflicts: diff.time_fixed_conflicts.map((c) => ({
      ...(c as Record<string, unknown>),
      task_id: String((c as Record<string, unknown>).task_id ?? ""),
      fixed_date: ((c as Record<string, unknown>).fixed_date as string | null | undefined) ?? null,
      reason: String((c as Record<string, unknown>).reason ?? "Time-fixed task needs review."),
      options: ["prioritize", "descope", "renegotiate"],
    })),
    insertions: diff.insertions,
    removed_or_unplanned: diff.removed_or_unplanned,
    unchanged_task_ids: diff.unchanged_task_ids,
    goal_impacts: diff.goal_impacts,
    planning_conflicts: diff.planning_conflicts,
    warnings: diff.warnings,
    split_report: splitReportToJson(diff.split_report),
  };
}

async function buildPlanningState(
  db: Executor,
  ctx: WorkspaceContext,
  opts: { startDate: string; scope?: ReplanScope },
): Promise<{ state: PlanningState; globalCapacityHoursPerDay: number }> {
  const goals: PlanningState["goals"] = {};
  const projects: PlanningState["projects"] = {};
  const milestones: PlanningState["milestones"] = {};
  const workPackages: PlanningState["workPackages"] = {};
  const tasks: PlanningState["tasks"] = {};

  const projectRows = await db
    .selectFrom("project as p")
    .innerJoin("goal as g", "g.id", "p.goal_id")
    .select([
      "p.id as id",
      "p.goal_id as goalId",
      "p.title as title",
      "p.capacity_hours_per_day as capacityHours",
      "p.target_end_date as targetEndDate",
      "p.position as position",
      "g.id as goalRowId",
      "g.title as goalTitle",
      "g.horizon as goalHorizon",
      "g.position as goalPosition",
    ])
    .where("p.workspace_id", "=", ctx.workspaceId)
    .where("p.status", "=", "active")
    .execute();

  for (const row of projectRows) {
    goals[row.goalRowId] = {
      id: row.goalRowId,
      title: row.goalTitle,
      horizon: row.goalHorizon,
      position: row.goalPosition,
    };
    projects[row.id] = {
      id: row.id,
      goalId: row.goalId,
      title: row.title,
      capacityHoursPerDay: Number(row.capacityHours),
      targetEndDate: row.targetEndDate,
      position: row.position,
      priority: row.position,
    };
  }

  const projectIds = Object.keys(projects);
  if (projectIds.length > 0) {
    const msRows = await db
      .selectFrom("milestone")
      .select(["id", "project_id", "title", "position"])
      .where("workspace_id", "=", ctx.workspaceId)
      .where("project_id", "in", projectIds)
      .execute();
    for (const m of msRows) {
      milestones[m.id] = { id: m.id, projectId: m.project_id, title: m.title, position: m.position };
    }

    const wpRows = await db
      .selectFrom("work_package")
      .select([
        "id",
        "project_id",
        "title",
        "milestone_id",
        "estimate_hours",
        "difficulty",
        "is_time_fixed",
        "fixed_date",
        "position",
      ])
      .where("workspace_id", "=", ctx.workspaceId)
      .where("project_id", "in", projectIds)
      .execute();
    for (const wp of wpRows) {
      workPackages[wp.id] = {
        id: wp.id,
        projectId: wp.project_id,
        title: wp.title,
        milestoneId: wp.milestone_id,
        estimateHours: resolveHours(
          wp.estimate_hours != null ? Number(wp.estimate_hours) : null,
          wp.difficulty,
        ),
        isTimeFixed: wp.is_time_fixed,
        fixedDate: wp.fixed_date,
        position: wp.position,
        priority: wp.position,
      };
    }

    const wpIds = Object.keys(workPackages);
    if (wpIds.length > 0) {
      const taskRows = await db
        .selectFrom("task")
        .select([
          "id",
          "work_package_id",
          "title",
          "estimate_hours",
          "difficulty",
          "status",
          "is_time_fixed",
          "fixed_date",
          "position",
          "original_task_id",
          "split_index",
          "split_count",
          "is_split_part",
          "replaced_at",
        ])
        .where("workspace_id", "=", ctx.workspaceId)
        .where("work_package_id", "in", wpIds)
        .where("replaced_at", "is", null)
        .execute();
      for (const task of taskRows) {
        tasks[task.id] = {
          id: task.id,
          workPackageId: task.work_package_id,
          title: task.title,
          estimateHours: resolveHours(
            task.estimate_hours != null ? Number(task.estimate_hours) : null,
            task.difficulty,
          ),
          status: task.status,
          isTimeFixed: task.is_time_fixed,
          fixedDate: task.fixed_date,
          position: task.position,
          priority: task.position,
          originalTaskId: task.original_task_id,
          splitIndex: task.split_index,
          splitCount: task.split_count,
          isSplitPart: task.is_split_part,
          replacedAt: task.replaced_at,
        };
      }
    }
  }

  const taskIds = new Set(Object.keys(tasks));
  const wpIds = new Set(Object.keys(workPackages));
  let taskDependencies = (
    await db
      .selectFrom("task_dependency")
      .select(["predecessor_task_id", "successor_task_id"])
      .where("workspace_id", "=", ctx.workspaceId)
      .execute()
  )
    .filter((d) => taskIds.has(d.predecessor_task_id) && taskIds.has(d.successor_task_id))
    .map((d) => ({
      predecessorTaskId: d.predecessor_task_id,
      successorTaskId: d.successor_task_id,
    }));

  let workPackageDependencies = (
    await db
      .selectFrom("work_package_dependency")
      .select(["predecessor_wp_id", "successor_wp_id"])
      .where("workspace_id", "=", ctx.workspaceId)
      .execute()
  )
    .filter((d) => wpIds.has(d.predecessor_wp_id) && wpIds.has(d.successor_wp_id))
    .map((d) => ({
      predecessorWpId: d.predecessor_wp_id,
      successorWpId: d.successor_wp_id,
    }));

  const dayRows = await db
    .selectFrom("daily_plan_day")
    .select(["id", "plan_date", "status", "is_locked"])
    .where("workspace_id", "=", ctx.workspaceId)
    .execute();
  const dayMeta: PlanningState["dayMeta"] = {};
  const dayDateById = new Map<string, string>();
  for (const day of dayRows) {
    dayDateById.set(day.id, day.plan_date);
    dayMeta[day.plan_date] = {
      isLocked: day.is_locked,
      isConfirmed: day.status === "confirmed" || day.status === "completed" || day.status === "slipped",
    };
  }

  const itemRows = await db
    .selectFrom("daily_plan_item")
    .select(["daily_plan_day_id", "task_id", "position"])
    .where("workspace_id", "=", ctx.workspaceId)
    .where("status", "=", "planned")
    .where("task_id", "is not", null)
    .orderBy("position")
    .execute();
  const currentPlan: PlanningState["currentPlan"] = {};
  for (const item of itemRows) {
    if (!item.task_id || !tasks[item.task_id]) continue;
    const date = dayDateById.get(item.daily_plan_day_id);
    if (!date) continue;
    (currentPlan[date] ??= []).push(item.task_id);
  }

  const frozenTaskIds = new Set<string>();
  for (const [date, ids] of Object.entries(currentPlan)) {
    for (const taskId of ids) {
      const task = tasks[taskId];
      const wp = task ? workPackages[task.workPackageId] : undefined;
      if (!task || !wp) continue;
      if (opts.scope?.project_id && wp.projectId !== opts.scope.project_id) frozenTaskIds.add(taskId);
      if (date < opts.startDate) frozenTaskIds.add(taskId);
    }
  }

  if (opts.scope?.project_id) {
    for (const [taskId, task] of Object.entries(tasks)) {
      const wp = workPackages[task.workPackageId];
      if (wp && wp.projectId !== opts.scope.project_id && !frozenTaskIds.has(taskId)) {
        delete tasks[taskId];
      }
    }
    const scopedTaskIds = new Set(Object.keys(tasks));
    taskDependencies = taskDependencies.filter(
      (d) => scopedTaskIds.has(d.predecessorTaskId) && scopedTaskIds.has(d.successorTaskId),
    );
    const scopedWpIds = new Set(
      Object.values(tasks).map((task) => task.workPackageId),
    );
    workPackageDependencies = workPackageDependencies.filter(
      (d) => scopedWpIds.has(d.predecessorWpId) && scopedWpIds.has(d.successorWpId),
    );
  }

  const stats = await db
    .selectFrom("user_stats")
    .select("global_capacity_hours_per_day")
    .where("user_id", "=", ctx.userId)
    .where("workspace_id", "=", ctx.workspaceId)
    .executeTakeFirst();

  return {
    state: {
      goals,
      projects,
      milestones,
      workPackages,
      tasks,
      taskDependencies,
      workPackageDependencies,
      currentPlan,
      dayMeta,
      frozenTaskIds: [...frozenTaskIds],
    },
    globalCapacityHoursPerDay: Number(stats?.global_capacity_hours_per_day ?? 8),
  };
}

/** Produce a read-only proposal diff for the current workspace state. */
export async function analyzeReplan(
  db: Executor,
  ctx: WorkspaceContext,
  opts: AnalyzeOptions = {},
): Promise<{ summary: string; changes: Changes }> {
  const now = opts.now ?? new Date();
  const startDate = opts.scope?.from_date ?? localDate(ctx.timezone, now);
  const horizonDays = opts.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const { state, globalCapacityHoursPerDay } = await buildPlanningState(db, ctx, {
    startDate,
    scope: opts.scope,
  });

  const config: PlannerConfig = {
    today: startDate,
    globalCapacityHoursPerDay,
    horizonDays,
    sameDayDependencies: true,
    allowTaskSplitting: opts.allowTaskSplitting ?? true,
    objective: "min_disruption",
    splitChunkHours: opts.splitChunkHours ?? null,
  };

  const plan = planRoadmap(state, config);
  const diff = createProposalDiff(state, plan);
  const changes = plannerDiffToChanges(diff);
  return { summary: summarize(changes), changes };
}
