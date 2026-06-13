/**
 * v1 planner implementation (deliberately simple, foundation Decision #19):
 *   - fill each day up to per-project capacity, in dependency/position order
 *   - skip blocked work (never schedule a task with incomplete predecessors)
 *   - pin time-fixed tasks to their fixed date
 *
 * It is a pure function of its input. Everything DB-shaped (gathering candidates,
 * computing blocked-state, persisting the draft) lives in the roadmap service
 * (src/domain/roadmap.ts), so this engine can be replaced wholesale later.
 */
import { addDays } from "../lib/dates";
import type { DraftDay, DraftDayItem, Planner, PlannerInput, ProjectCapacity } from "./types";

class SimpleFillPlanner implements Planner {
  proposeDays(input: PlannerInput): DraftDay[] {
    const { startDate, horizonDays, candidates, capacities } = input;

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

    // 1) Pin time-fixed work to its date (commitments win; may exceed capacity).
    for (const c of schedulable) {
      if (c.isTimeFixed && c.fixedDate && horizon.has(c.fixedDate)) {
        place(c.fixedDate, c);
      }
    }

    // 2) Fill flexible work into the earliest day with room, in dependency/
    //    position order. Sort by project then position for a stable, readable plan.
    const flexible = schedulable
      .filter((c) => !c.isTimeFixed)
      .sort((a, b) =>
        a.projectId === b.projectId
          ? a.position - b.position
          : a.projectId < b.projectId
            ? -1
            : 1,
      );

    for (const c of flexible) {
      const cap = capOf(c.projectId);
      if (cap <= 0) continue; // project has no capacity configured → can't schedule
      for (const date of dates) {
        const rem = remOf(date, c.projectId);
        // Fits, or the day is still empty for this project (place oversize tasks
        // rather than never scheduling them).
        if (rem >= c.hours || rem === cap) {
          place(date, c);
          break;
        }
      }
    }

    return dates
      .map((planDate) => ({ planDate, items: itemsByDate.get(planDate)! }))
      .filter((d) => d.items.length > 0);
  }
}

/** The process-wide planner. A single swap point per Decision #19. */
export const planner: Planner = new SimpleFillPlanner();

export type { Planner, PlannerInput, DraftDay, DraftDayItem } from "./types";
