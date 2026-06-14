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

/** The local wall-clock time ('HH:MM', 24h) for `at` in the given IANA timezone. */
export function localTime(timezone: string, at: Date = new Date()): string {
  // en-GB + hour12:false yields a zero-padded 00–23 'HH:MM' that string-compares
  // correctly against `notification_preference.morning_brief_time` ('HH:MM:SS').
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  // Some runtimes emit '24:00' for midnight; normalise to '00:00'.
  return fmt.format(at).replace(/^24:/, "00:");
}

/**
 * The UTC instant of LOCAL midnight that opens `dateStr` in `timezone`. The
 * inverse of `localDate`: `localDate(tz, zonedDayStart(tz, d)) === d`. Used to
 * turn a 'YYYY-MM-DD' query bound into a `timestamptz` comparison point so a date
 * range means end-of-day LOCAL (invariant #3), not a UTC instant. One offset pass
 * is exact except in the rare hour straddling a DST transition, which is fine for
 * inclusive history bounds.
 */
export function zonedDayStart(timezone: string, dateStr: string): Date {
  const utcGuess = new Date(`${dateStr}T00:00:00Z`);
  // What wall-clock does that instant show in `timezone`? The gap is the offset.
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(utcGuess).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  const offset = asUTC - utcGuess.getTime();
  return new Date(utcGuess.getTime() - offset);
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
