/**
 * Resource modules — thin typed wrappers over apiRequest, one group per /v1
 * resource. Components/hooks import from here; they never call apiRequest or
 * build paths themselves.
 */
import { apiRequest } from "./client";
import type {
  ApproveProposalResult,
  BootstrapResult,
  CompleteTaskResult,
  CreateWorkPackageResult,
  DayView,
  DailyPlanDay,
  DailyPlanItem,
  DifficultyLevel,
  Goal,
  GoalHorizon,
  GoalWithProgress,
  MeView,
  Milestone,
  MilestoneWithState,
  MorningBrief,
  Project,
  ProposalStatus,
  ProposedDay,
  ReplanChanges,
  ReplanProposal,
  ReplanProposalDetail,
  Roadmap,
  StatsView,
  Task,
  TaskDependency,
  TaskWithBlocked,
  WorkPackage,
  WorkPackageDependency,
  WorkPackageWithStatus,
} from "@api-types";

/**
 * Estimation is either hours OR difficulty, never both (Decision #13 → 422).
 * Modeled as a discriminated union so a request structurally can't carry both;
 * the A3 form's segmented control maps directly onto these variants.
 */
export type Estimation =
  | { estimate_hours: number; difficulty?: undefined }
  | { difficulty: DifficultyLevel; estimate_hours?: undefined }
  | { estimate_hours?: undefined; difficulty?: undefined };

/** Time-fixed is paired: `is_time_fixed` true ⇒ `fixed_date` set (else 422). */
export type TimeFixed = { is_time_fixed?: false } | { is_time_fixed: true; fixed_date: string };

export type WorkPackageBody = {
  title: string;
  description?: string | null;
  milestone_id?: string | null;
} & Estimation &
  TimeFixed;

export type TaskBody = {
  title: string;
  notes?: string | null;
} & Estimation &
  TimeFixed;

export const authApi = {
  /** POST /auth/bootstrap — idempotent first-login provisioning. */
  bootstrap: (body: { email?: string; display_name?: string | null; timezone?: string | null }) =>
    apiRequest<BootstrapResult>("/auth/bootstrap", { method: "POST", body }),
};

export const meApi = {
  get: () => apiRequest<MeView>("/me"),
  stats: () => apiRequest<StatsView>("/me/stats"),
};

export const morningBriefApi = {
  /** GET /morning-brief — the composite home read (records ⚡eng once server-side). */
  get: () => apiRequest<MorningBrief>("/morning-brief"),
};

export const goalsApi = {
  list: () => apiRequest<Goal[]>("/goals"),
  get: (id: string, includeProgress = false) =>
    apiRequest<Goal | GoalWithProgress>(
      `/goals/${id}`,
      includeProgress ? { query: { include: "progress" } } : {},
    ),
  /** POST /goals — A1. */
  create: (body: { title: string; horizon: GoalHorizon; description?: string | null }) =>
    apiRequest<Goal>("/goals", { method: "POST", body }),
  /** PATCH /goals/{id} — A1 edit on resume/back (no duplicate create). */
  update: (
    id: string,
    body: { title?: string; horizon?: GoalHorizon; description?: string | null },
  ) => apiRequest<Goal>(`/goals/${id}`, { method: "PATCH", body }),
  listProjects: (goalId: string) => apiRequest<Project[]>(`/goals/${goalId}/projects`),
  /** POST /goals/{id}/projects — A2 (capacity defaulted here, PATCHed at A5). */
  createProject: (
    goalId: string,
    body: {
      title: string;
      capacity_hours_per_day: number;
      description?: string | null;
      target_end_date?: string | null;
    },
  ) => apiRequest<Project>(`/goals/${goalId}/projects`, { method: "POST", body }),
};

export const projectsApi = {
  get: (id: string) => apiRequest<Project>(`/projects/${id}`),
  /** PATCH /projects/{id} — A5 sets the real capacity; also A2 edit on back. */
  update: (
    id: string,
    body: {
      title?: string;
      description?: string | null;
      capacity_hours_per_day?: number;
      target_end_date?: string | null;
    },
  ) => apiRequest<Project>(`/projects/${id}`, { method: "PATCH", body }),
  listWorkPackages: (projectId: string) =>
    apiRequest<WorkPackageWithStatus[]>(`/projects/${projectId}/work-packages`),
  listMilestones: (projectId: string) =>
    apiRequest<MilestoneWithState[]>(`/projects/${projectId}/milestones`),
  /** POST /projects/{id}/milestones — A4. */
  createMilestone: (projectId: string, body: { title: string; description?: string | null }) =>
    apiRequest<Milestone>(`/projects/${projectId}/milestones`, { method: "POST", body }),
  /** POST /projects/{id}/work-packages — A3. Returns { work_package, replan_proposal? }. */
  createWorkPackage: (projectId: string, body: WorkPackageBody) =>
    apiRequest<CreateWorkPackageResult>(`/projects/${projectId}/work-packages`, {
      method: "POST",
      body,
    }),
};

export const workPackagesApi = {
  listTasks: (wpId: string) => apiRequest<TaskWithBlocked[]>(`/work-packages/${wpId}/tasks`),
  /** PATCH /work-packages/{id} — A4 (re)assigns a WP to a milestone. */
  update: (id: string, body: { milestone_id?: string | null }) =>
    apiRequest<WorkPackage>(`/work-packages/${id}`, { method: "PATCH", body }),
  /** DELETE /work-packages/{id} — A3 inline delete (cascades its tasks). */
  remove: (id: string) => apiRequest<void>(`/work-packages/${id}`, { method: "DELETE" }),
  /** POST /work-packages/{id}/tasks — A3. */
  createTask: (wpId: string, body: TaskBody) =>
    apiRequest<Task>(`/work-packages/${wpId}/tasks`, { method: "POST", body }),
};

export const dependenciesApi = {
  /** POST /task-dependencies — A4 (409 on cycle). */
  createTaskEdge: (body: { predecessor_task_id: string; successor_task_id: string }) =>
    apiRequest<TaskDependency>("/task-dependencies", { method: "POST", body }),
  /** POST /work-package-dependencies — A4 (409 on cycle). */
  createWpEdge: (body: { predecessor_wp_id: string; successor_wp_id: string }) =>
    apiRequest<WorkPackageDependency>("/work-package-dependencies", { method: "POST", body }),
  /** DELETE /work-package-dependencies/{pred}/{succ} — undo a drawn edge. */
  removeWpEdge: (predecessorWpId: string, successorWpId: string) =>
    apiRequest<void>(`/work-package-dependencies/${predecessorWpId}/${successorWpId}`, {
      method: "DELETE",
    }),
};

export const roadmapApi = {
  get: (query?: { from?: string; to?: string; goal_id?: string }) =>
    apiRequest<Roadmap>("/roadmap", { query }),
  /** POST /roadmap/propose — A6. Returns proposed days; the confirm date is read from this. */
  propose: (body?: { horizon_days?: number; goal_id?: string }) =>
    apiRequest<ProposedDay[]>("/roadmap/propose", { method: "POST", body: body ?? {} }),
};

export const daysApi = {
  get: (date: string) => apiRequest<DayView>(`/days/${date}`),
  /** POST /days/{date}/confirm — A7 + roadmap confirm. The date MUST come from the propose response. */
  confirm: (date: string) =>
    apiRequest<DailyPlanDay>(`/days/${date}/confirm`, { method: "POST" }),
  /** PATCH /days/{date} — lock/unlock the day (F3 day drawer). */
  setLock: (date: string, isLocked: boolean) =>
    apiRequest<DailyPlanDay>(`/days/${date}`, { method: "PATCH", body: { is_locked: isLocked } }),
  /** POST /days/{date}/items — add a task to the day, origin 'user_added' (F3). */
  addItem: (date: string, taskId: string, position?: number) =>
    apiRequest<DailyPlanItem>(`/days/${date}/items`, {
      method: "POST",
      body: position != null ? { task_id: taskId, position } : { task_id: taskId },
    }),
};

export const planItemsApi = {
  /** PATCH /plan-items/{id} — reorder (position) or defer (status='deferred'). */
  patch: (id: string, body: { position?: number; status?: string }) =>
    apiRequest<DailyPlanItem>(`/plan-items/${id}`, { method: "PATCH", body }),
  /** DELETE /plan-items/{id} — remove from the day (204). */
  remove: (id: string) => apiRequest<void>(`/plan-items/${id}`, { method: "DELETE" }),
};

export const replanApi = {
  /** GET /replan-proposals?status= — defaults to pending. */
  list: (status: ProposalStatus = "pending") =>
    apiRequest<ReplanProposal[]>("/replan-proposals", { query: { status } }),
  /** GET /replan-proposals/{id} — the full structured diff for review. */
  get: (id: string) => apiRequest<ReplanProposalDetail>(`/replan-proposals/${id}`),
  /** POST /replan-proposals — user-initiated replan (trigger fixed server-side). */
  create: (scope?: { project_id?: string; from_date?: string }) =>
    apiRequest<ReplanProposal>("/replan-proposals", {
      method: "POST",
      body: scope ? { trigger: "user_request", scope } : { trigger: "user_request" },
    }),
  /**
   * POST /replan-proposals/{id}/approve. Omit `edits` for a plain approve (applies
   * the stored diff). Pass the FULL edited diff (built by buildApproveEdits) when the
   * user resolved a time-fixed conflict or unchecked a move — `edits` REPLACES the
   * stored changes, so it must carry the original moves too (status → edited_approved).
   */
  approve: (id: string, edits?: ReplanChanges) =>
    apiRequest<ApproveProposalResult>(`/replan-proposals/${id}/approve`, {
      method: "POST",
      body: edits ? { edits } : {},
    }),
  /** POST /replan-proposals/{id}/reject — plan untouched. */
  reject: (id: string) =>
    apiRequest<ReplanProposal>(`/replan-proposals/${id}/reject`, { method: "POST" }),
};

export const tasksApi = {
  complete: (id: string) =>
    apiRequest<CompleteTaskResult>(`/tasks/${id}/complete`, { method: "POST" }),
  reopen: (id: string) => apiRequest<Task>(`/tasks/${id}/reopen`, { method: "POST" }),
  /** DELETE /tasks/{id} — A3 inline delete. */
  remove: (id: string) => apiRequest<void>(`/tasks/${id}`, { method: "DELETE" }),
};
