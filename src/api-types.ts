/**
 * api-types.ts — the PUBLIC HTTP contract of the /v1 API, as plain JSON shapes.
 *
 * This file is the single source of truth shared with the web frontend. It is
 * deliberately PURE: it imports NOTHING (no Kysely, no pg, no Node) so the
 * frontend can alias-import it without pulling a server dependency into the
 * browser bundle.
 *
 * Why not re-export `db/types.ts`? Those are Kysely `Selectable<>` row types —
 * they model the DATABASE row (e.g. `created_at: Date`, numeric columns as the
 * pg driver returns them), not the JSON that crosses the wire. After
 * `NextResponse.json(...)` every `Date` is an ISO string and every `numeric` is
 * a string. These DTOs reflect that on-the-wire reality.
 *
 * Keep in lockstep with the route handlers + domain return types by hand; the
 * frontend's `tsc --noEmit` is the drift backstop.
 */

// ---- Enums (mirror db/types.ts string unions) ------------------------------
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

/** ISO-8601 timestamp string (e.g. "2026-06-18T08:30:00.000Z"). */
export type IsoTimestamp = string;
/** Postgres `date` rendered as "YYYY-MM-DD". */
export type DateString = string;
/** Postgres `numeric` rendered by the pg driver as a string. */
export type NumericString = string;

// ---- Entities (JSON shapes) ------------------------------------------------
export interface AppUser {
  id: string;
  auth_subject: string;
  email: string;
  display_name: string | null;
  timezone: string;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface Workspace {
  id: string;
  name: string;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface Goal {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  horizon: GoalHorizon;
  status: GoalStatus;
  achieved_at: IsoTimestamp | null;
  position: number;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface Project {
  id: string;
  workspace_id: string;
  goal_id: string;
  title: string;
  description: string | null;
  capacity_hours_per_day: NumericString;
  status: ProjectStatus;
  target_end_date: DateString | null;
  completed_at: IsoTimestamp | null;
  position: number;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface Task {
  id: string;
  workspace_id: string;
  work_package_id: string;
  title: string;
  notes: string | null;
  estimate_hours: NumericString | null;
  difficulty: DifficultyLevel | null;
  is_time_fixed: boolean;
  fixed_date: DateString | null;
  status: TaskStatus;
  completed_at: IsoTimestamp | null;
  position: number;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface DailyPlanDay {
  id: string;
  workspace_id: string;
  plan_date: DateString;
  status: DayStatus;
  is_locked: boolean;
  confirmed_at: IsoTimestamp | null;
  completed_at: IsoTimestamp | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface DailyPlanItem {
  id: string;
  workspace_id: string;
  daily_plan_day_id: string;
  item_type: PlanItemType;
  task_id: string | null;
  status: PlanItemStatus;
  origin: PlanItemOrigin;
  position: number;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

// ---- Derived / composite shapes --------------------------------------------
export interface Progress {
  percent_done: number;
  tasks_done: number;
  tasks_total: number;
  estimate_done_hours: number;
  estimate_total_hours: number;
}

export type GoalWithProgress = Goal & { progress: Progress };

/** A lightweight task reference embedded in roadmap/day reads. */
export interface RoadmapTaskRef {
  id: string;
  title: string;
  status: string;
}

/** GET /me */
export interface MeView {
  user: AppUser;
  workspace: Workspace;
  role: string;
}

/** POST /auth/bootstrap */
export interface BootstrapResult {
  user: AppUser;
  workspace: Workspace;
}

/** GET /me/stats */
export interface StatsView {
  total_points: number;
  current_streak: number;
  longest_streak: number;
  last_engaged_date: DateString | null;
}

/** GET /days/{date} */
export interface DayView {
  day: DailyPlanDay;
  items: { item: DailyPlanItem; task: RoadmapTaskRef | null }[];
}

/** GET /morning-brief */
export interface MorningBrief {
  today: DayView | null;
  stats: StatsView;
  pending_proposal: { id: string; summary: string } | null;
  position: { today: DateString; current_streak: number };
  next_milestone: {
    id: string;
    title: string;
    projected_date: DateString;
    days_away: number;
  } | null;
}

export interface RoadmapItem {
  task_id: string;
  task: RoadmapTaskRef | null;
  status: string | null;
  origin: string | null;
  position: number;
}

export interface RoadmapDay {
  date: DateString;
  status: DayStatus | "projected";
  is_locked: boolean;
  projected: boolean;
  items: RoadmapItem[];
}

/** GET /roadmap */
export interface Roadmap {
  days: RoadmapDay[];
  milestones: { id: string; projected_date: DateString | null }[];
  position: { today: DateString; current_streak: number };
}

/** POST /tasks/{id}/complete */
export interface CompleteTaskResult {
  task: Task;
  points_awarded: number;
  day_completed?: { daily_plan_day_id: string; plan_date: DateString; points_awarded: number };
  milestone_achieved?: { milestone_id: string; title: string; points_awarded: number };
}

// ---- Errors ----------------------------------------------------------------
/** The error envelope every /v1 failure returns (see src/lib/http.ts). */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
