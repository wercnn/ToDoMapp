import type { TaskStatus } from "../db/types";

export interface PositionTaskRef {
  id: string;
  workPackageId: string;
  position: number;
  status: TaskStatus;
  replacedAt?: Date | string | null;
}

export interface PositionTaskDependency {
  predecessorTaskId: string;
  successorTaskId: string;
}

function activeTasksByWorkPackage(rows: PositionTaskRef[]): Map<string, PositionTaskRef[]> {
  const byWp = new Map<string, PositionTaskRef[]>();
  for (const row of rows) {
    if (row.replacedAt) continue;
    const arr = byWp.get(row.workPackageId) ?? [];
    arr.push(row);
    byWp.set(row.workPackageId, arr);
  }
  for (const arr of byWp.values()) {
    arr.sort((a, b) => {
      if (a.position !== b.position) return a.position - b.position;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }
  return byWp;
}

export function derivePositionTaskDependencies(rows: PositionTaskRef[]): PositionTaskDependency[] {
  const deps: PositionTaskDependency[] = [];
  for (const tasks of activeTasksByWorkPackage(rows).values()) {
    for (let i = 0; i < tasks.length - 1; i++) {
      deps.push({
        predecessorTaskId: tasks[i]!.id,
        successorTaskId: tasks[i + 1]!.id,
      });
    }
  }
  return deps;
}

export function derivePositionBlockedTaskIds(rows: PositionTaskRef[]): Set<string> {
  const blocked = new Set<string>();
  for (const tasks of activeTasksByWorkPackage(rows).values()) {
    let hasOpenPredecessor = false;
    for (const task of tasks) {
      if (hasOpenPredecessor && task.status !== "done") blocked.add(task.id);
      if (task.status !== "done") hasOpenPredecessor = true;
    }
  }
  return blocked;
}
