import { unprocessable } from "../../lib/errors";
import { hasCycle } from "./graph";
import type { PlanningState } from "./types";

export function validatePlanningState(state: PlanningState): void {
  for (const dep of state.taskDependencies) {
    const pred = state.tasks[dep.predecessorTaskId];
    const succ = state.tasks[dep.successorTaskId];
    if (!pred || !succ) {
      throw unprocessable(
        `Unknown task dependency: ${dep.predecessorTaskId} -> ${dep.successorTaskId}`,
      );
    }
    if (dep.predecessorTaskId === dep.successorTaskId) {
      throw unprocessable(`Invalid self task dependency: ${dep.predecessorTaskId}`);
    }
    if (pred.workPackageId !== succ.workPackageId) {
      throw unprocessable(
        `Invalid task dependency ${dep.predecessorTaskId}->${dep.successorTaskId}: task dependencies must stay inside the same work package.`,
      );
    }
  }

  for (const dep of state.workPackageDependencies) {
    const pred = state.workPackages[dep.predecessorWpId];
    const succ = state.workPackages[dep.successorWpId];
    if (!pred || !succ) {
      throw unprocessable(
        `Unknown work-package dependency: ${dep.predecessorWpId} -> ${dep.successorWpId}`,
      );
    }
    if (dep.predecessorWpId === dep.successorWpId) {
      throw unprocessable(`Invalid self work-package dependency: ${dep.predecessorWpId}`);
    }
    if (pred.projectId !== succ.projectId) {
      throw unprocessable(
        `Invalid work-package dependency ${dep.predecessorWpId}->${dep.successorWpId}: v1 work-package dependencies must stay inside the same project.`,
      );
    }
  }

  if (
    hasCycle(
      Object.keys(state.tasks),
      state.taskDependencies.map((d) => ({ from: d.predecessorTaskId, to: d.successorTaskId })),
    )
  ) {
    throw unprocessable("Task dependency cycle detected.");
  }

  if (
    hasCycle(
      Object.keys(state.workPackages),
      state.workPackageDependencies.map((d) => ({ from: d.predecessorWpId, to: d.successorWpId })),
    )
  ) {
    throw unprocessable("Work-package dependency cycle detected.");
  }
}
