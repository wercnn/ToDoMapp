/**
 * Project Detail data (F4). The header + Table share these reads; the Flow view
 * adds its own single `GET /projects/{id}/flow`, and the Timeline adds `GET /roadmap`.
 *
 * Deliberately NO upfront task fetch: tasks load lazily per work-package on expand
 * (`useWorkPackageTasks`) so the screen is ~3 reads (project + WPs + milestones),
 * never a per-WP fan-out. The flow payload omits milestone/estimate/time-fixed/position,
 * so the Table can't be fed from it — these typed reads carry the full fields.
 */
import { useQuery } from "@tanstack/react-query";
import type { ProjectWithProgress } from "@api-types";
import { goalsApi, projectsApi, workPackagesApi } from "@/api";

export function useProject(projectId: string) {
  return useQuery({
    queryKey: ["project", projectId, "progress"],
    queryFn: () => projectsApi.get(projectId, true) as Promise<ProjectWithProgress>,
  });
}

export function useParentGoal(goalId: string | undefined) {
  return useQuery({
    queryKey: ["goal", goalId],
    queryFn: () => goalsApi.get(goalId as string),
    enabled: goalId != null,
  });
}

export function useWorkPackages(projectId: string) {
  return useQuery({
    queryKey: ["project", projectId, "work-packages"],
    queryFn: () => projectsApi.listWorkPackages(projectId),
  });
}

export function useMilestones(projectId: string) {
  return useQuery({
    queryKey: ["project", projectId, "milestones"],
    queryFn: () => projectsApi.listMilestones(projectId),
  });
}

/** Lazy per-WP task read — enabled only when the row is expanded / sheet open. */
export function useWorkPackageTasks(wpId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["work-package", wpId, "tasks"],
    queryFn: () => workPackagesApi.listTasks(wpId as string),
    enabled: enabled && wpId != null,
  });
}

/** The query keys to invalidate after any WBS mutation in this project. */
export function projectQueryKeys(projectId: string) {
  return [
    ["project", projectId, "progress"],
    ["project", projectId, "work-packages"],
    ["project", projectId, "milestones"],
    ["project", projectId, "flow"],
  ];
}
