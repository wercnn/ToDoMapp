/**
 * Hand-written Kysely database interface — the schema is authored in SQL
 * (supabase/migrations), NOT generated from TypeScript. This file must be kept
 * in lockstep with the migrations; it is the typed lens the API reads/writes
 * through.
 *
 * Conventions:
 *  - `Generated<T>`  — column has a DB default (id, timestamps, status, etc.);
 *                      optional on insert.
 *  - `Timestamp`     — timestamptz; `Date` on read, accepts Date/ISO string on write.
 *  - `DateString`    — Postgres `date`; returned as 'YYYY-MM-DD' string.
 *  - `Numeric`       — Postgres numeric; returned as string (pg default), accepts number.
 */
import type { ColumnType, Generated, Insertable, Selectable, Updateable } from "kysely";

type Timestamp = ColumnType<Date, Date | string, Date | string>;
// DB-defaulted timestamp: optional on insert (created_at/updated_at/occurred_at…).
// NOTE: don't wrap this in Kysely's `Generated<…>` — that would nest a ColumnType
// inside a ColumnType and break Kysely's insert/update type extraction.
type GeneratedTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type DateString = ColumnType<string, string, string>;
type Numeric = ColumnType<string, number | string, number | string>;
type Json = ColumnType<unknown, string, string>;

// ---- Enums (mirror §2) -----------------------------------------------------
export type GoalHorizon = "short" | "mid" | "long";
export type GoalStatus = "active" | "achieved" | "archived";
export type ProjectStatus = "active" | "completed" | "archived";
export type DifficultyLevel = "low" | "mid" | "high";
export type TaskStatus = "todo" | "done";
export type DayStatus = "proposed" | "confirmed" | "completed" | "slipped";
export type PlanItemType = "task";
export type PlanItemStatus = "planned" | "completed" | "deferred";
export type PlanItemOrigin = "proposed" | "user_added" | "pulled_forward" | "replanned";
export type ProposalTrigger = "slippage" | "new_work_package" | "user_request";
export type ProposalStatus = "pending" | "approved" | "edited_approved" | "rejected" | "expired";
export type PointEventType = "task_completed" | "daily_goal_completed" | "milestone_achieved";
export type WorkspaceRole = "owner";
export type DevicePlatform = "ios";

// ---- Tables ----------------------------------------------------------------

export interface WorkspaceTable {
  id: Generated<string>;
  name: string;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface AppUserTable {
  id: Generated<string>;
  auth_subject: string;
  email: string;
  display_name: string | null;
  timezone: Generated<string>;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface WorkspaceMemberTable {
  workspace_id: string;
  user_id: string;
  role: Generated<WorkspaceRole>;
  created_at: GeneratedTimestamp;
}

export interface DeviceTable {
  id: Generated<string>;
  user_id: string;
  platform: Generated<DevicePlatform>;
  push_token: string;
  last_seen_at: Timestamp | null;
  created_at: GeneratedTimestamp;
}

export interface GoalTable {
  id: Generated<string>;
  workspace_id: string;
  title: string;
  description: string | null;
  horizon: GoalHorizon;
  status: Generated<GoalStatus>;
  achieved_at: Timestamp | null;
  position: Generated<number>;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface ProjectTable {
  id: Generated<string>;
  workspace_id: string;
  goal_id: string;
  title: string;
  description: string | null;
  capacity_hours_per_day: Numeric;
  status: Generated<ProjectStatus>;
  target_end_date: DateString | null;
  completed_at: Timestamp | null;
  position: Generated<number>;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface MilestoneTable {
  id: Generated<string>;
  workspace_id: string;
  project_id: string;
  title: string;
  description: string | null;
  achieved_at: Timestamp | null;
  position: Generated<number>;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface WorkPackageTable {
  id: Generated<string>;
  workspace_id: string;
  project_id: string;
  milestone_id: string | null;
  title: string;
  description: string | null;
  estimate_hours: Numeric | null;
  difficulty: DifficultyLevel | null;
  is_time_fixed: Generated<boolean>;
  fixed_date: DateString | null;
  completed_at: Timestamp | null;
  position: Generated<number>;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface TaskTable {
  id: Generated<string>;
  workspace_id: string;
  work_package_id: string;
  title: string;
  notes: string | null;
  estimate_hours: Numeric | null;
  difficulty: DifficultyLevel | null;
  is_time_fixed: Generated<boolean>;
  fixed_date: DateString | null;
  status: Generated<TaskStatus>;
  completed_at: Timestamp | null;
  position: Generated<number>;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface TaskDependencyTable {
  predecessor_task_id: string;
  successor_task_id: string;
  workspace_id: string;
  created_at: GeneratedTimestamp;
}

export interface WorkPackageDependencyTable {
  predecessor_wp_id: string;
  successor_wp_id: string;
  workspace_id: string;
  created_at: GeneratedTimestamp;
}

export interface DailyPlanDayTable {
  id: Generated<string>;
  workspace_id: string;
  plan_date: DateString;
  status: Generated<DayStatus>;
  is_locked: Generated<boolean>;
  confirmed_at: Timestamp | null;
  completed_at: Timestamp | null;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface DailyPlanItemTable {
  id: Generated<string>;
  workspace_id: string;
  daily_plan_day_id: string;
  item_type: Generated<PlanItemType>;
  task_id: string | null;
  status: Generated<PlanItemStatus>;
  origin: Generated<PlanItemOrigin>;
  position: Generated<number>;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface ReplanProposalTable {
  id: Generated<string>;
  workspace_id: string;
  trigger: ProposalTrigger;
  status: Generated<ProposalStatus>;
  summary: string;
  changes: Json;
  applied_changes: Json | null;
  resolved_by_user_id: string | null;
  resolved_at: Timestamp | null;
  created_at: GeneratedTimestamp;
}

export interface PointRuleTable {
  event_type: PointEventType;
  points: number;
}

export interface PointEventTable {
  id: Generated<string>;
  workspace_id: string;
  user_id: string;
  event_type: PointEventType;
  points: number;
  task_id: string | null;
  daily_plan_day_id: string | null;
  milestone_id: string | null;
  occurred_at: GeneratedTimestamp;
}

export interface EngagementDayTable {
  user_id: string;
  activity_date: DateString;
  workspace_id: string;
  first_engaged_at: GeneratedTimestamp;
}

export interface UserStatsTable {
  user_id: string;
  workspace_id: string;
  total_points: Generated<number>;
  current_streak: Generated<number>;
  longest_streak: Generated<number>;
  last_engaged_date: DateString | null;
  updated_at: GeneratedTimestamp;
}

export interface NotificationPreferenceTable {
  user_id: string;
  morning_brief_enabled: Generated<boolean>;
  morning_brief_time: Generated<string>;
  milestone_nudges_enabled: Generated<boolean>;
  replan_nudges_enabled: Generated<boolean>;
  streak_nudges_enabled: Generated<boolean>;
  updated_at: GeneratedTimestamp;
}

// ---- The database interface Kysely is parameterised on --------------------
export interface Database {
  workspace: WorkspaceTable;
  app_user: AppUserTable;
  workspace_member: WorkspaceMemberTable;
  device: DeviceTable;
  goal: GoalTable;
  project: ProjectTable;
  milestone: MilestoneTable;
  work_package: WorkPackageTable;
  task: TaskTable;
  task_dependency: TaskDependencyTable;
  work_package_dependency: WorkPackageDependencyTable;
  daily_plan_day: DailyPlanDayTable;
  daily_plan_item: DailyPlanItemTable;
  replan_proposal: ReplanProposalTable;
  point_rule: PointRuleTable;
  point_event: PointEventTable;
  engagement_day: EngagementDayTable;
  user_stats: UserStatsTable;
  notification_preference: NotificationPreferenceTable;
}

// Convenience row types.
export type Goal = Selectable<GoalTable>;
export type NewGoal = Insertable<GoalTable>;
export type GoalUpdate = Updateable<GoalTable>;
export type Project = Selectable<ProjectTable>;
export type NewProject = Insertable<ProjectTable>;
export type Milestone = Selectable<MilestoneTable>;
export type WorkPackage = Selectable<WorkPackageTable>;
export type NewWorkPackage = Insertable<WorkPackageTable>;
export type Task = Selectable<TaskTable>;
export type NewTask = Insertable<TaskTable>;
export type TaskDependency = Selectable<TaskDependencyTable>;
export type WorkPackageDependency = Selectable<WorkPackageDependencyTable>;
export type DailyPlanDay = Selectable<DailyPlanDayTable>;
export type DailyPlanItem = Selectable<DailyPlanItemTable>;
export type ReplanProposal = Selectable<ReplanProposalTable>;
export type PointEvent = Selectable<PointEventTable>;
export type AppUser = Selectable<AppUserTable>;
export type Workspace = Selectable<WorkspaceTable>;
