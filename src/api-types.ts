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
/** Derived (never stored) status of a work package (data-model §6). */
export type WorkPackageStatus = "open" | "in_progress" | "done" | "blocked";

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

export interface Milestone {
  id: string;
  workspace_id: string;
  project_id: string;
  title: string;
  description: string | null;
  achieved_at: IsoTimestamp | null;
  position: number;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface WorkPackage {
  id: string;
  workspace_id: string;
  project_id: string;
  milestone_id: string | null;
  title: string;
  description: string | null;
  estimate_hours: NumericString | null;
  difficulty: DifficultyLevel | null;
  is_time_fixed: boolean;
  fixed_date: DateString | null;
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
  original_task_id: string | null;
  split_index: number | null;
  split_count: number | null;
  is_split_part: boolean;
  replaced_at: IsoTimestamp | null;
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
export type ProjectWithProgress = Project & { progress: Progress };

/** GET /projects/{id}/work-packages — list with derived status. */
export type WorkPackageWithStatus = WorkPackage & { derived_status: WorkPackageStatus };
/** GET /work-packages/{id}?include=tasks */
export type WorkPackageWithTasks = WorkPackage & { tasks: Task[] };
/** GET /tasks/{id} and GET /work-packages/{id}/tasks — derived blocked flag. */
export type TaskWithBlocked = Task & { blocked: boolean };

/** GET /projects/{id}/milestones — list with derived achievement state + projected date. */
export interface MilestoneWithState extends Milestone {
  achieved: boolean;
  projected_date: DateString | null;
  wp_done: number;
  wp_total: number;
}

// ---- Project flow diagram (GET /projects/{id}/flow, api §5 / data-model §6) --
/** Derived (never stored) status of a flow node. Mirrors `src/domain/flow.ts`. */
export type DerivedStatus = "done" | "blocked" | "in_progress" | "open";

/** One node in the flow graph — a work package or a task. */
export interface FlowNode {
  id: string;
  kind: "work_package" | "task";
  title: string;
  /** Set for task nodes — the owning work package. */
  work_package_id?: string;
  /** Nominal planning hours (difficulty already mapped; unestimated → default). */
  hours: number;
  derived_status: DerivedStatus;
}

/** The two edge families: task→task and WP→WP finish-before edges. */
export interface FlowEdges {
  task: { predecessor_task_id: string; successor_task_id: string }[];
  work_package: { predecessor_wp_id: string; successor_wp_id: string }[];
}

/** GET /projects/{id}/flow — fully-derived graph for the Flow diagram (Principle 5). */
export interface ProjectFlow {
  nodes: FlowNode[];
  edges: FlowEdges;
  /** Ordered task-id sequence of the critical path to the next milestone (may be empty). */
  critical_path: string[];
  next_milestone: { id: string; title: string; projected_date: DateString | null } | null;
}

/** A task→task or WP→WP finish-before edge (POST /task-dependencies, /work-package-dependencies). */
export interface TaskDependency {
  predecessor_task_id: string;
  successor_task_id: string;
  workspace_id: string;
  created_at: IsoTimestamp;
}
export interface WorkPackageDependency {
  predecessor_wp_id: string;
  successor_wp_id: string;
  workspace_id: string;
  created_at: IsoTimestamp;
}

/** A replan proposal row (returned embedded in the WP-create envelope when confirmed days exist). */
export interface ReplanProposal {
  id: string;
  workspace_id: string;
  trigger: ProposalTrigger;
  status: ProposalStatus;
  summary: string;
  created_at: IsoTimestamp;
}

// ---- Replan diff (the `changes` JSONB; review UI contract, api §11) ---------
/** One per-item move. `from_date=null` ⇒ newly scheduled; `to_date=null` ⇒ descheduled. */
export interface ReplanMove {
  task_id: string;
  from_date: DateString | null;
  to_date: DateString | null;
  task_title?: string;
  original_task_id?: string | null;
  split_index?: number | null;
  split_count?: number | null;
  delta_days?: number | null;
}

/** A milestone projection shift — DESCRIPTIVE ONLY (projection, never committed). */
export interface ReplanMilestoneImpact {
  milestone_id: string;
  title: string;
  from_projected_date: DateString | null;
  to_projected_date: DateString | null;
}

export type TimeFixedOption = "prioritize" | "descope" | "renegotiate";

/** A time-fixed commitment at risk — surfaced separately, never auto-moved (Decision #7). */
export interface TimeFixedConflict {
  task_id: string;
  fixed_date: DateString | null;
  reason: string;
  options: TimeFixedOption[];
}

export interface ReplanInsertion {
  task_id: string;
  task_title: string;
  to_date: DateString;
  original_task_id?: string | null;
  split_index?: number | null;
  split_count?: number | null;
}

export interface ReplanRemovedOrUnplanned {
  task_id: string;
  task_title: string;
  from_date: DateString;
  original_task_id?: string | null;
  split_index?: number | null;
  split_count?: number | null;
}

export interface ReplanGoalImpact {
  goal_id: string;
  title: string;
  from_projected_date: DateString | null;
  to_projected_date: DateString | null;
  delta_days: number | null;
}

export interface PlanningConflict {
  type: string;
  task_id?: string;
  task_title?: string;
  date?: DateString;
  reason?: string;
  suggestion?: string;
  options?: string[];
  [key: string]: unknown;
}

export interface TaskSplitPart {
  task_id: string;
  title: string;
  hours: number;
  to_date?: DateString | null;
}

export interface TaskSplitReport {
  original_task_id: string;
  original_title: string;
  original_hours: number;
  max_chunk_hours: number;
  split_count: number;
  parts: TaskSplitPart[];
}

export type ReplanDayDecisionStatus = "approved" | "rejected";

export interface ReplanDayDecision {
  date: DateString;
  status: ReplanDayDecisionStatus;
  decided_at: IsoTimestamp;
}

export interface ReplanTodayCapacity {
  date: DateString;
  global_capacity_hours: number;
  completed_hours: number;
  remaining_hours: number;
}

/** The user's explicit choice for a conflict, supplied on edited approval. */
export interface TimeFixedResolution {
  task_id: string;
  choice: TimeFixedOption;
  /** Required iff `choice='renegotiate'` — the new committed date. */
  new_fixed_date?: DateString | null;
}

/** The structured diff stored in `replan_proposal.changes` (and the `edits` shape on approve). */
export interface ReplanChanges {
  moves: ReplanMove[];
  milestone_impacts: ReplanMilestoneImpact[];
  time_fixed_conflicts: TimeFixedConflict[];
  insertions?: ReplanInsertion[];
  removed_or_unplanned?: ReplanRemovedOrUnplanned[];
  unchanged_task_ids?: string[];
  goal_impacts?: ReplanGoalImpact[];
  planning_conflicts?: PlanningConflict[];
  warnings?: string[];
  split_report?: TaskSplitReport[];
  split_task_id_map?: Record<string, string>;
  review_dates?: DateString[];
  day_decisions?: ReplanDayDecision[];
  rejected_dates?: DateString[];
  kept_today_task_ids?: string[];
  today_capacity?: ReplanTodayCapacity;
  /** Present only on edited approval, authorizing time-fixed moves (invariant #4). */
  time_fixed_resolutions?: TimeFixedResolution[];
}

export interface ReplanPreview {
  roadmap: Roadmap;
  changed_dates: DateString[];
  next_pending_date: DateString | null;
  day_decisions: ReplanDayDecision[];
  rejected_dates: DateString[];
  today_capacity: ReplanTodayCapacity | null;
}

/** GET /replan-proposals/{id} — full proposal + its structured diff for the review UI. */
export interface ReplanProposalDetail {
  proposal: ReplanProposal;
  changes: ReplanChanges;
  refs: { tasks: Record<string, RoadmapTaskRef> };
  preview?: ReplanPreview;
}

/** POST /replan-proposals/{id}/approve — the resolved proposal + what the apply step wrote. */
export interface ApproveProposalResult {
  proposal: ReplanProposal;
  applied: { days: DailyPlanDay[]; items: DailyPlanItem[] };
}

/**
 * POST /projects/{id}/work-packages. `replan_proposal` is present only when
 * confirmed roadmap days already exist (mid-flight add) — never during onboarding,
 * where WPs are created before any day is proposed.
 */
export interface CreateWorkPackageResult {
  work_package: WorkPackage;
  replan_proposal?: ReplanProposal;
}

/** One element of the POST /roadmap/propose response (status `proposed`). */
export interface ProposedDay {
  day: DailyPlanDay;
  items: DailyPlanItem[];
}

/** A lightweight task reference embedded in roadmap/day reads. */
export interface RoadmapTaskRef {
  id: string;
  title: string;
  status: TaskStatus;
  project_id: string;
  project_title: string;
  work_package_id: string;
  work_package_title: string;
  estimate_hours: NumericString | null;
  difficulty: DifficultyLevel | null;
  is_time_fixed: boolean;
  fixed_date: DateString | null;
  original_task_id: string | null;
  split_index: number | null;
  split_count: number | null;
  is_split_part: boolean;
  replaced_at: IsoTimestamp | null;
  blocked: boolean;
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
  global_capacity_hours_per_day: NumericString;
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
  milestones: {
    id: string;
    title: string;
    achieved: boolean;
    achieved_date: DateString | null;
    projected_date: DateString | null;
  }[];
  position: { today: DateString; current_streak: number };
}

/** POST /tasks/{id}/complete */
export interface CompleteTaskResult {
  task: Task;
  points_awarded: number;
  day_completed?: { daily_plan_day_id: string; plan_date: DateString; points_awarded: number };
  milestone_achieved?: { milestone_id: string; title: string; points_awarded: number };
}

/** POST /tasks/{id}/pull-forward */
export interface PullForwardResult {
  item: DailyPlanItem;
  day: DailyPlanDay;
}

// ---- Errors ----------------------------------------------------------------
/** The error envelope every /v1 failure returns (see src/lib/http.ts). */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
