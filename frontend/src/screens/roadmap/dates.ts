/**
 * Roadmap date helpers. Plan dates are "YYYY-MM-DD" wall-clock strings — parse them
 * as LOCAL midnight (never `new Date("YYYY-MM-DD")`, which is UTC and shifts the day
 * backwards in negative-offset zones).
 */
export function parseLocalDate(date: string): Date {
  const [y, m, d] = date.split("-");
  return new Date(Number(y), Number(m) - 1, Number(d));
}

export function formatDay(date: string): { weekday: string; rest: string } {
  const dt = parseLocalDate(date);
  return {
    weekday: dt.toLocaleDateString(undefined, { weekday: "short" }),
    rest: dt.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  };
}

/** Whole days from `today` to `date` (negative = past). Both are plan-date strings. */
export function daysFromToday(today: string, date: string): number {
  const ms = parseLocalDate(date).getTime() - parseLocalDate(today).getTime();
  return Math.round(ms / 86_400_000);
}
