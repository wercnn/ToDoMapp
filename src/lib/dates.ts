/**
 * Day-boundary helpers. The day boundary is midnight LOCAL time, computed from
 * app_user.timezone (Decision #14, invariant #3). All `plan_date` / `activity_date`
 * derivations route through here so the boundary is computed in exactly one place.
 */

/** The local calendar date ('YYYY-MM-DD') for `at` in the given IANA timezone. */
export function localDate(timezone: string, at: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD; timeZone shifts the wall clock to the user's tz.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(at);
}

/** Add `n` days to a 'YYYY-MM-DD' date string (calendar arithmetic, UTC-anchored). */
export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** Validate a 'YYYY-MM-DD' string; returns it or throws via the provided factory. */
export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
