import type {
  DayView,
  ReplanProposalDetail,
  Roadmap,
  RoadmapDay,
  RoadmapTaskRef,
} from "@api-types";

export interface TodayProgress {
  total: number;
  done: number;
  percent: number;
  current: RoadmapTaskRef | null;
}

export function deriveTodayProgress(items: DayView["items"] = []): TodayProgress {
  const total = items.length;
  const done = items.filter((entry) => entry.item.status === "completed").length;
  const current = items.find((entry) => entry.item.status !== "completed")?.task ?? null;
  return {
    total,
    done,
    percent: total > 0 ? Math.round((done / total) * 100) : 0,
    current,
  };
}

export interface TaskGroup {
  projectId: string;
  projectTitle: string;
  workPackageId: string;
  workPackageTitle: string;
  items: DayView["items"];
}

export function groupDayItems(items: DayView["items"] = []): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();
  for (const entry of items) {
    const task = entry.task;
    const key = task ? `${task.project_id}:${task.work_package_id}` : "unknown:unknown";
    const group =
      groups.get(key) ??
      ({
        projectId: task?.project_id ?? "unknown",
        projectTitle: task?.project_title ?? "Unassigned project",
        workPackageId: task?.work_package_id ?? "unknown",
        workPackageTitle: task?.work_package_title ?? "Unassigned work",
        items: [],
      } satisfies TaskGroup);
    group.items.push(entry);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function selectRoadAhead(roadmap: Roadmap | undefined, today: string, limit = 8): RoadmapDay[] {
  if (!roadmap) return [];
  return roadmap.days
    .filter((day) => day.date >= today && day.items.length > 0)
    .slice(0, limit);
}

/** Done / total task counts for a single roadmap day (drives the day node ring). */
export function dayProgress(day: RoadmapDay): { done: number; total: number } {
  const total = day.items.length;
  const done = day.items.filter((item) => item.status === "completed").length;
  return { done, total };
}

/** A day is "complete" when it has tasks and every one is done. */
export function isDayComplete(day: RoadmapDay): boolean {
  const { done, total } = dayProgress(day);
  return total > 0 && done === total;
}

export function mapProposalTaskRefs(detail: ReplanProposalDetail | undefined) {
  return detail?.refs?.tasks ?? {};
}
