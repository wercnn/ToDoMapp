export type DateString = string;

export interface Goal {
  id: string;
  title: string;
  horizon?: string;
  position: number;
}

export interface Project {
  id: string;
  goalId: string;
  title: string;
  capacityHoursPerDay: number;
  targetEndDate: DateString | null;
  position: number;
  priority: number;
}

export interface Milestone {
  id: string;
  projectId: string;
  title: string;
  position: number;
}

export interface WorkPackage {
  id: string;
  projectId: string;
  title: string;
  milestoneId: string | null;
  estimateHours: number | null;
  isTimeFixed: boolean;
  fixedDate: DateString | null;
  position: number;
  priority: number;
}

export interface Task {
  id: string;
  workPackageId: string;
  title: string;
  estimateHours: number;
  status: "todo" | "done";
  isTimeFixed: boolean;
  fixedDate: DateString | null;
  position: number;
  priority: number;
  originalTaskId: string | null;
  splitIndex: number | null;
  splitCount: number | null;
  isSplitPart: boolean;
  replacedAt?: Date | string | null;
}

export interface TaskDependency {
  predecessorTaskId: string;
  successorTaskId: string;
}

export interface WorkPackageDependency {
  predecessorWpId: string;
  successorWpId: string;
}

export interface DayMeta {
  isLocked: boolean;
  isConfirmed: boolean;
  note?: string;
}

export interface PlannerConfig {
  today: DateString;
  globalCapacityHoursPerDay: number;
  horizonDays: number;
  sameDayDependencies: boolean;
  allowTaskSplitting: boolean;
  objective: "min_disruption" | "earliest_completion";
  splitChunkHours?: number | null;
}

export interface PlanningState {
  goals: Record<string, Goal>;
  projects: Record<string, Project>;
  milestones: Record<string, Milestone>;
  workPackages: Record<string, WorkPackage>;
  tasks: Record<string, Task>;
  taskDependencies: TaskDependency[];
  workPackageDependencies: WorkPackageDependency[];
  currentPlan: Record<DateString, string[]>;
  dayMeta: Record<DateString, DayMeta>;
  /** Assigned and capacity-counted, but not eligible for movement. */
  frozenTaskIds?: string[];
}

export interface PlanningConflict {
  type: string;
  taskId?: string;
  taskTitle?: string;
  date?: DateString;
  reason?: string;
  suggestion?: string;
  options?: string[];
  [key: string]: unknown;
}

export interface TaskSplitPart {
  taskId: string;
  title: string;
  hours: number;
  toDate?: DateString | null;
}

export interface TaskSplitReport {
  originalTaskId: string;
  originalTitle: string;
  originalHours: number;
  maxChunkHours: number;
  splitCount: number;
  parts: TaskSplitPart[];
}

export interface PlanResult {
  assignment: Record<string, DateString>;
  dayItems: Record<DateString, string[]>;
  dayLoad: Record<DateString, number>;
  projectDayLoad: Record<string, number>;
  conflicts: PlanningConflict[];
  warnings: string[];
  milestoneDates: Record<string, DateString | null>;
  projectDates: Record<string, DateString | null>;
  goalDates: Record<string, DateString | null>;
  splitReport: TaskSplitReport[];
  expandedState: PlanningState;
}

export interface ReplanMove {
  task_id: string;
  task_title?: string;
  original_task_id?: string | null;
  split_index?: number | null;
  split_count?: number | null;
  from_date: DateString | null;
  to_date: DateString | null;
  delta_days?: number | null;
}

export interface ReplanInsertion {
  task_id: string;
  task_title: string;
  original_task_id: string | null;
  split_index: number | null;
  split_count: number | null;
  to_date: DateString;
}

export interface ReplanRemovedOrUnplanned {
  task_id: string;
  task_title: string;
  original_task_id: string | null;
  split_index: number | null;
  split_count: number | null;
  from_date: DateString;
}

export interface ReplanMilestoneImpact {
  milestone_id: string;
  title: string;
  from_projected_date: DateString | null;
  to_projected_date: DateString | null;
  delta_days: number | null;
}

export interface ReplanGoalImpact {
  goal_id: string;
  title: string;
  from_projected_date: DateString | null;
  to_projected_date: DateString | null;
  delta_days: number | null;
}

export interface ReplanProposalDiff {
  summary: string;
  moves: ReplanMove[];
  milestone_impacts: ReplanMilestoneImpact[];
  time_fixed_conflicts: PlanningConflict[];
  insertions: ReplanInsertion[];
  removed_or_unplanned: ReplanRemovedOrUnplanned[];
  unchanged_task_ids: string[];
  goal_impacts: ReplanGoalImpact[];
  planning_conflicts: PlanningConflict[];
  warnings: string[];
  split_report: TaskSplitReport[];
}
