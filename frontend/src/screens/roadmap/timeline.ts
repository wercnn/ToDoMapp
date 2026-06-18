/**
 * Pure roadmap-timeline builder (extracted from Roadmap.tsx so it's unit-testable,
 * same pattern as buildApproveEdits). It merges day-steps and milestone landmarks into
 * one chronological list.
 *
 * Milestone dating: an ACHIEVED milestone has no incomplete tasks left, so the backend
 * projection can't date it (`projected_date` is null). It carries `achieved_date`
 * instead — so we anchor each landmark at `achieved_date ?? projected_date`, keeping the
 * just-celebrated milestone visible (and lit) on the path rather than dropping it into
 * the "undatable" footnote. Only when BOTH are null is a milestone genuinely undated.
 */
import type { Roadmap as RoadmapDto, RoadmapDay } from "@api-types";

/** A chronological entry: a day-step or a milestone landmark. */
export type Entry =
  | { kind: "day"; date: string; day: RoadmapDay }
  | { kind: "milestone"; date: string; id: string; title: string; achieved: boolean };

export function buildTimeline(data: RoadmapDto): { entries: Entry[]; undated: string[] } {
  const entries: Entry[] = data.days.map((day) => ({ kind: "day", date: day.date, day }));
  const undated: string[] = [];
  for (const ms of data.milestones) {
    const date = ms.achieved_date ?? ms.projected_date;
    if (date)
      entries.push({ kind: "milestone", date, id: ms.id, title: ms.title, achieved: ms.achieved });
    else undated.push(ms.id);
  }
  // Chronological; a milestone sorts AFTER the day it lands on (landmark closes the day).
  entries.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.kind === "milestone" && b.kind === "day" ? 1 : a.kind === "day" && b.kind === "milestone" ? -1 : 0;
  });
  return { entries, undated };
}
