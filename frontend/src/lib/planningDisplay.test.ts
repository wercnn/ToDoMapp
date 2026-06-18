import { describe, expect, it } from "vitest";
import type { DayView, ReplanProposalDetail, Roadmap } from "@api-types";
import {
  deriveTodayProgress,
  groupDayItems,
  mapProposalTaskRefs,
  selectRoadAhead,
} from "./planningDisplay";

const taskA = {
  id: "task-a",
  title: "Sketch flow",
  status: "todo",
  project_id: "project-a",
  project_title: "Web app",
  work_package_id: "wp-a",
  work_package_title: "Prototype parity",
  estimate_hours: "1.5",
  difficulty: null,
  is_time_fixed: false,
  fixed_date: null,
  blocked: false,
} as const;

const taskB = {
  ...taskA,
  id: "task-b",
  title: "Wire API",
  work_package_id: "wp-b",
  work_package_title: "Backend reads",
  status: "done",
} as const;

function dayItems(): DayView["items"] {
  return [
    { item: { id: "item-a", task_id: "task-a", status: "planned" }, task: taskA },
    { item: { id: "item-b", task_id: "task-b", status: "completed" }, task: taskB },
  ] as DayView["items"];
}

describe("planningDisplay", () => {
  it("derives top-bar progress and current incomplete task", () => {
    expect(deriveTodayProgress(dayItems())).toEqual({
      total: 2,
      done: 1,
      percent: 50,
      current: taskA,
    });
  });

  it("groups day items by project and work package", () => {
    const groups = groupDayItems(dayItems());
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.workPackageTitle)).toEqual([
      "Prototype parity",
      "Backend reads",
    ]);
  });

  it("selects upcoming road-ahead days from today", () => {
    const roadmap = {
      days: [
        { date: "2026-06-18", items: [{ task_id: "old" }] },
        { date: "2026-06-19", items: [{ task_id: "today" }] },
        { date: "2026-06-20", items: [] },
        { date: "2026-06-21", items: [{ task_id: "next" }] },
      ],
    } as Roadmap;

    expect(selectRoadAhead(roadmap, "2026-06-19").map((day) => day.date)).toEqual([
      "2026-06-19",
      "2026-06-21",
    ]);
  });

  it("maps proposal task refs", () => {
    const detail = { refs: { tasks: { "task-a": taskA } } } as unknown as ReplanProposalDetail;
    expect(mapProposalTaskRefs(detail)["task-a"]).toBe(taskA);
  });

  it("tolerates older proposal details without refs", () => {
    const detail = { changes: { moves: [], milestone_impacts: [], time_fixed_conflicts: [] } } as unknown as ReplanProposalDetail;
    expect(mapProposalTaskRefs(detail)).toEqual({});
  });
});
