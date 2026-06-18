/**
 * Candidate tasks for "add to this day": every open (`todo`), unblocked task in the
 * workspace that isn't already on the open day. There's no global task-list endpoint,
 * so we walk the WBS (goals → projects → work-packages → tasks) lazily — only when
 * the add picker is opened (`enabled`), at personal-workspace scale.
 */
import { useQuery } from "@tanstack/react-query";
import type { TaskWithBlocked } from "@api-types";
import { goalsApi, projectsApi, workPackagesApi } from "@/api";

export interface AddableTask {
  id: string;
  title: string;
}

async function fetchAddableTasks(excludeTaskIds: Set<string>): Promise<AddableTask[]> {
  const goals = await goalsApi.list();
  const projectLists = await Promise.all(goals.map((g) => goalsApi.listProjects(g.id)));
  const projects = projectLists.flat();
  const wpLists = await Promise.all(projects.map((p) => projectsApi.listWorkPackages(p.id)));
  const wps = wpLists.flat();
  const taskLists = await Promise.all(wps.map((wp) => workPackagesApi.listTasks(wp.id)));
  const tasks = taskLists.flat() as TaskWithBlocked[];

  return tasks
    .filter((t) => t.status === "todo" && !t.blocked && !excludeTaskIds.has(t.id))
    .map((t) => ({ id: t.id, title: t.title }));
}

export function useAddableTasks(enabled: boolean, excludeTaskIds: string[]) {
  const exclude = new Set(excludeTaskIds);
  return useQuery({
    queryKey: ["addable-tasks", [...exclude].sort()],
    queryFn: () => fetchAddableTasks(exclude),
    enabled,
    staleTime: 30_000,
  });
}
