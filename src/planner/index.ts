/**
 * v1 planner implementation (deliberately simple, foundation Decision #19):
 *   - fill each day up to per-project capacity, in dependency/position order
 *   - skip blocked work (never schedule a task with incomplete predecessors)
 *   - pin time-fixed tasks to their fixed date
 *   - STAGED UNBLOCKING when `edges` are supplied: a successor lands only on a day
 *     strictly after all its placed predecessors. With no edges this is inert, so
 *     output is identical to the original fill (the roadmap projection passes edges;
 *     `/propose` passes none).
 *
 * It is a pure function of its input. Everything DB-shaped (gathering candidates,
 * computing blocked-state, expanding WP→task edges, persisting the draft) lives in
 * the domain services (roadmap.ts / projection.ts), so this engine stays replaceable.
 */
import { addDays } from "../lib/dates";
import type {
  DraftDay,
  DraftDayItem,
  Planner,
  PlannerInput,
  ProjectCapacity,
  TaskEdge,
} from "./types";

class SimpleFillPlanner implements Planner {
  proposeDays(input: PlannerInput): DraftDay[] {
    const { startDate, horizonDays, candidates, capacities, edges } = input;

    const dates: string[] = [];
    for (let i = 0; i < horizonDays; i++) dates.push(addDays(startDate, i));
    const horizon = new Set(dates);

    const capacityByProject = new Map<string, number>(
      capacities.map((c: ProjectCapacity) => [c.projectId, c.hoursPerDay]),
    );

    // Remaining capacity per `${date}|${projectId}`, lazily seeded from capacity.
    const remaining = new Map<string, number>();
    const key = (date: string, projectId: string) => `${date}|${projectId}`;
    const capOf = (projectId: string) => capacityByProject.get(projectId) ?? 0;
    const remOf = (date: string, projectId: string) => {
      const k = key(date, projectId);
      if (!remaining.has(k)) remaining.set(k, capOf(projectId));
      return remaining.get(k)!;
    };

    const itemsByDate = new Map<string, DraftDayItem[]>();
    for (const d of dates) itemsByDate.set(d, []);
    const place = (date: string, c: { taskId: string; projectId: string; hours: number }) => {
      itemsByDate.get(date)!.push({ taskId: c.taskId, projectId: c.projectId });
      remaining.set(key(date, c.projectId), remOf(date, c.projectId) - c.hours);
    };

    const schedulable = candidates.filter((c) => !c.blocked);
    const schedulableIds = new Set(schedulable.map((c) => c.taskId));

    // The day index a task was placed on (pinned tasks recorded here too). A task
    // absent from this map after placement simply never fit (→ caller treats as
    // unscheduled; for projection that means an unknown/null projected date).
    const placedIndex = new Map<string, number>();
    const dateIndex = new Map(dates.map((d, i) => [d, i]));

    // 1) Pin time-fixed work to its date (commitments win; may exceed capacity).
    for (const c of schedulable) {
      if (c.isTimeFixed && c.fixedDate && horizon.has(c.fixedDate)) {
        place(c.fixedDate, c);
        placedIndex.set(c.taskId, dateIndex.get(c.fixedDate)!);
      }
    }

    // 2) Fill flexible work into the earliest eligible day with room. "Eligible"
    //    means on or after the day after every placed predecessor (staged
    //    unblocking). Process in dependency order, ties broken by (project,
    //    position) — with no edges every task is immediately ready, so this reduces
    //    to the original (project, position) sweep over the full horizon.
    const flexible = schedulable.filter((c) => !c.isTimeFixed);
    const flexibleIds = new Set(flexible.map((c) => c.taskId));

    // Predecessors that constrain a flexible task: any edge whose successor is this
    // flexible task and whose predecessor is in the schedulable set (pinned or
    // flexible). Edges into pinned tasks are ignored — commitments aren't staged.
    const edgeList: TaskEdge[] = edges ?? [];
    const preds = new Map<string, string[]>(); // successor → [predecessor]
    const indeg = new Map<string, number>(flexible.map((c) => [c.taskId, 0]));
    for (const e of edgeList) {
      if (!flexibleIds.has(e.successorTaskId)) continue; // successor not staged here
      if (!schedulableIds.has(e.predecessorTaskId)) continue; // predecessor dropped
      (preds.get(e.successorTaskId) ?? preds.set(e.successorTaskId, []).get(e.successorTaskId)!).push(
        e.predecessorTaskId,
      );
      // Only a FLEXIBLE predecessor adds topological indegree (pinned ones are
      // already placed, so they never gate readiness — only the eligible day).
      if (flexibleIds.has(e.predecessorTaskId)) {
        indeg.set(e.successorTaskId, (indeg.get(e.successorTaskId) ?? 0) + 1);
      }
    }

    const byOrder = (a: typeof flexible[number], b: typeof flexible[number]) =>
      a.projectId === b.projectId
        ? a.position - b.position
        : a.projectId < b.projectId
          ? -1
          : 1;
    const flexById = new Map(flexible.map((c) => [c.taskId, c]));

    // Ready set = flexible tasks with no unplaced flexible predecessor, always
    // drained in (project, position) order for a stable, readable plan.
    let ready = flexible.filter((c) => (indeg.get(c.taskId) ?? 0) === 0).sort(byOrder);
    const succs = new Map<string, string[]>(); // predecessor → [successor]
    for (const [succ, ps] of preds) {
      for (const p of ps) (succs.get(p) ?? succs.set(p, []).get(p)!).push(succ);
    }

    while (ready.length > 0) {
      const c = ready.shift()!;
      const cap = capOf(c.projectId);

      // Earliest eligible day index = day after the latest placed predecessor.
      let earliest = 0;
      for (const p of preds.get(c.taskId) ?? []) {
        const pi = placedIndex.get(p);
        if (pi == null) {
          earliest = Number.POSITIVE_INFINITY; // predecessor never fit → can't place
          break;
        }
        earliest = Math.max(earliest, pi + 1);
      }

      if (cap > 0 && Number.isFinite(earliest)) {
        for (let i = earliest; i < dates.length; i++) {
          const date = dates[i]!;
          const rem = remOf(date, c.projectId);
          // Fits, or the day is still empty for this project (place oversize tasks
          // rather than never scheduling them).
          if (rem >= c.hours || rem === cap) {
            place(date, c);
            placedIndex.set(c.taskId, i);
            break;
          }
        }
      }

      // Releasing successors keeps topological order regardless of placement success
      // (an unplaced predecessor leaves the successor unplaceable, handled above).
      const newlyReady: typeof flexible = [];
      for (const s of succs.get(c.taskId) ?? []) {
        indeg.set(s, (indeg.get(s) ?? 0) - 1);
        if (indeg.get(s) === 0) {
          const sc = flexById.get(s);
          if (sc) newlyReady.push(sc);
        }
      }
      if (newlyReady.length > 0) ready = ready.concat(newlyReady).sort(byOrder);
    }

    return dates
      .map((planDate) => ({ planDate, items: itemsByDate.get(planDate)! }))
      .filter((d) => d.items.length > 0);
  }
}

/** The process-wide planner. A single swap point per Decision #19. */
export const planner: Planner = new SimpleFillPlanner();

export type { Planner, PlannerInput, DraftDay, DraftDayItem, TaskEdge } from "./types";
export * as replanPlanner from "./replan";
