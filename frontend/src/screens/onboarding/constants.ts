/**
 * The project is created at A2 (the API requires a capacity), but the user
 * doesn't *choose* capacity until A5. We seed this obvious placeholder and make
 * A5 clearly a "confirm or change" so nobody ends up with a silent default
 * driving their roadmap. Propose (A6) runs after A5, so capacity is always the
 * user's value by the time it shapes the plan.
 */
export const DEFAULT_CAPACITY_HOURS = 2;
