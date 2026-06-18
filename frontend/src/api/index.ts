/**
 * Resource modules — thin typed wrappers over apiRequest, one group per /v1
 * resource. Components/hooks import from here; they never call apiRequest or
 * build paths themselves.
 */
import { apiRequest } from "./client";
import type {
  BootstrapResult,
  CompleteTaskResult,
  DayView,
  Goal,
  GoalWithProgress,
  MeView,
  MorningBrief,
  Roadmap,
  StatsView,
  Task,
} from "@api-types";

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
};

export const roadmapApi = {
  get: (query?: { from?: string; to?: string; goal_id?: string }) =>
    apiRequest<Roadmap>("/roadmap", { query }),
};

export const daysApi = {
  get: (date: string) => apiRequest<DayView>(`/days/${date}`),
};

export const tasksApi = {
  complete: (id: string) =>
    apiRequest<CompleteTaskResult>(`/tasks/${id}/complete`, { method: "POST" }),
  reopen: (id: string) => apiRequest<Task>(`/tasks/${id}/reopen`, { method: "POST" }),
};
