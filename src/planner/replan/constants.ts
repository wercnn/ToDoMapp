/**
 * Defaults for the virtual-capacity repair loop (scheduler STEP 8/10/11). The
 * scheduler proposes *extra* (overload) hours only within these bounds; past them
 * it gives up and emits an `infeasible_plan` conflict rather than an endless ramp.
 *
 * These are `PlannerConfig` fallbacks — `analyzeReplan` may override per request /
 * user setting (the spec's "maximum allowed extra capacity" input). Setting
 * `maxIterations` or `maxExtraGlobalHoursPerDay` to 0 disables the repair loop, in
 * which case missed deadlines surface as plain conflicts (the pre-v2 behavior).
 */
export const MAX_ITERATIONS = 100;

/** Hard cap on proposed extra hours on any single day (global + per project). */
export const MAX_EXTRA_GLOBAL_HOURS_PER_DAY = 4;

/** Hard cap on proposed extra hours in any rolling 7-day window. */
export const MAX_EXTRA_HOURS_PER_WEEK = 10;

/** Granularity of each proposed capacity bump, and of the STEP-11 minimization. */
export const CAPACITY_INCREMENT_STEP = 0.5;

export interface ResolvedRepairLimits {
  maxIterations: number;
  maxExtraGlobalHoursPerDay: number;
  maxExtraHoursPerWeek: number;
  capacityIncrementStep: number;
}

/** Resolve repair-loop limits from a (partial) config, falling back to the defaults above. */
export function resolveRepairLimits(config: {
  maxIterations?: number;
  maxExtraGlobalHoursPerDay?: number;
  maxExtraHoursPerWeek?: number;
  capacityIncrementStep?: number;
}): ResolvedRepairLimits {
  return {
    maxIterations: config.maxIterations ?? MAX_ITERATIONS,
    maxExtraGlobalHoursPerDay: config.maxExtraGlobalHoursPerDay ?? MAX_EXTRA_GLOBAL_HOURS_PER_DAY,
    maxExtraHoursPerWeek: config.maxExtraHoursPerWeek ?? MAX_EXTRA_HOURS_PER_WEEK,
    capacityIncrementStep: config.capacityIncrementStep ?? CAPACITY_INCREMENT_STEP,
  };
}
