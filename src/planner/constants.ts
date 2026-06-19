/**
 * Planner constants. The difficulty → nominal-hours mapping is a planner constant,
 * NOT schema (data-model §9.2). Placeholder values — to be tuned in design
 * (foundation §10 open question). If this ever needs to be per-user-tunable, it
 * graduates to a `difficulty_mapping` table; until then it lives here.
 */
import type { DifficultyLevel } from "../db/types";

export const DIFFICULTY_HOURS: Record<DifficultyLevel, number> = {
  low: 1,
  mid: 2,
  high: 4,
};

/** Tasks with neither an hours estimate nor a difficulty get this nominal load. */
export const DEFAULT_TASK_HOURS = 1.5;

/** Resolve a task's nominal planning hours from its either/or estimate. */
export function resolveHours(
  estimateHours: number | null,
  difficulty: DifficultyLevel | null,
): number {
  if (estimateHours != null) return estimateHours;
  if (difficulty != null) return DIFFICULTY_HOURS[difficulty];
  return DEFAULT_TASK_HOURS;
}
