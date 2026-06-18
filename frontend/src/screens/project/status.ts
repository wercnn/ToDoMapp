/**
 * Shared display helpers for Project Detail (F4). Maps the backend's derived
 * statuses onto the single StatusPill vocabulary and formats estimates so the
 * Table / Flow / sheet read identically. Pure — no I/O.
 */
import type {
  DerivedStatus,
  DifficultyLevel,
  NumericString,
  TaskWithBlocked,
  WorkPackageStatus,
} from "@api-types";
import type { StatusKind } from "@/components/StatusPill";

/** WP/flow derived status already lines up with StatusPill's vocabulary. */
export function wpStatusKind(s: WorkPackageStatus | DerivedStatus): StatusKind {
  return s as StatusKind;
}

/**
 * Task derived status for the Table. `listTasks` gives raw status + blocked but
 * NOT planned-today (that lives only in the flow payload), so the Table shows
 * done / blocked / open. Flow view uses the richer per-node `derived_status`.
 */
export function taskStatusKind(t: Pick<TaskWithBlocked, "status" | "blocked">): StatusKind {
  if (t.status === "done") return "done";
  if (t.blocked) return "blocked";
  return "open";
}

/** A short human estimate: "2h", "Difficulty: mid", or "—" when unestimated. */
export function formatEstimate(
  estimate_hours: NumericString | null,
  difficulty: DifficultyLevel | null,
): string {
  if (estimate_hours != null) {
    const n = Number(estimate_hours);
    return Number.isFinite(n) ? `${n}h` : "—";
  }
  if (difficulty != null) return difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
  return "—";
}
