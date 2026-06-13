/**
 * The planner's narrow interface (foundation Decision #19). Nothing outside this
 * file's types may depend on HOW the planner works — callers assemble a
 * `PlannerInput` and receive `DraftDay[]`. Swapping the v1 fill-to-capacity
 * implementation for something smarter later touches only src/planner.
 *
 * Capacity is a PARAMETER (`capacities`), not read from the project table by the
 * planner. v1 is per-project hours/day; a per-day capacity model can replace the
 * `ProjectCapacity[]` shape without changing the interface.
 */

/** A schedulable task, already resolved to nominal hours and blocked-state. */
export interface PlannerCandidate {
  taskId: string;
  projectId: string;
  /** Nominal planning hours (difficulty already mapped; unestimated → default). */
  hours: number;
  isTimeFixed: boolean;
  fixedDate: string | null; // 'YYYY-MM-DD'
  /** Derived from the dependency graph by the caller; blocked work is skipped. */
  blocked: boolean;
  /** Stable ordering hint (project-local position). */
  position: number;
}

/** Per-project daily capacity (v1 model). */
export interface ProjectCapacity {
  projectId: string;
  hoursPerDay: number;
}

/**
 * A task-level "must finish before" edge (predecessor → successor). The caller
 * expands work-package dependencies to task level before passing them in (the m×n
 * fan-out, same as flow.ts). Used for STAGED UNBLOCKING: a successor may only land
 * on a day strictly after all its placed predecessors.
 *
 * This is what lets the roadmap projection see PAST a dependency wall (schedule A,
 * then B the next day) instead of dropping B as "blocked" forever. The near-horizon
 * `/propose` caller passes none (it deliberately schedules only already-unblocked
 * work and re-proposes as tasks complete) — absent/empty `edges` ⇒ identical output.
 */
export interface TaskEdge {
  predecessorTaskId: string;
  successorTaskId: string;
}

export interface PlannerInput {
  /** Local 'today' ('YYYY-MM-DD') — the first day of the horizon. */
  startDate: string;
  horizonDays: number;
  candidates: PlannerCandidate[];
  capacities: ProjectCapacity[];
  /** Optional dependency edges for staged unblocking. Absent/empty → no staging. */
  edges?: TaskEdge[];
}

export interface DraftDayItem {
  taskId: string;
  projectId: string;
}

export interface DraftDay {
  planDate: string; // 'YYYY-MM-DD'
  items: DraftDayItem[];
}

export interface Planner {
  /** Pure: same input → same draft. No I/O, no DB. */
  proposeDays(input: PlannerInput): DraftDay[];
}
