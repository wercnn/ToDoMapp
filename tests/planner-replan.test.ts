import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/errors";
import {
  createProposalDiff,
  expandStateForTaskSplitting,
  planRoadmap,
  type PlannerConfig,
  type PlanningState,
  type Task,
} from "@/planner/replan";

const today = "2026-06-19";

function task(overrides: Partial<Task> & { id: string; workPackageId: string; title?: string; estimateHours?: number }): Task {
  const { id, workPackageId, ...rest } = overrides;
  return {
    id,
    workPackageId,
    title: overrides.title ?? id,
    estimateHours: overrides.estimateHours ?? 1,
    status: "todo",
    isTimeFixed: false,
    fixedDate: null,
    position: 0,
    priority: 3,
    originalTaskId: null,
    splitIndex: null,
    splitCount: null,
    isSplitPart: false,
    replacedAt: null,
    ...rest,
  };
}

function baseState(): PlanningState {
  return {
    goals: { G: { id: "G", title: "Goal", horizon: "mid", position: 0 } },
    projects: {
      P: {
        id: "P",
        goalId: "G",
        title: "Project",
        capacityHoursPerDay: 2,
        targetEndDate: null,
        position: 0,
        priority: 1,
      },
    },
    milestones: { M: { id: "M", projectId: "P", title: "Milestone", position: 0 } },
    workPackages: {
      W1: {
        id: "W1",
        projectId: "P",
        title: "WP1",
        milestoneId: "M",
        estimateHours: null,
        isTimeFixed: false,
        fixedDate: null,
        position: 0,
        priority: 1,
      },
      W2: {
        id: "W2",
        projectId: "P",
        title: "WP2",
        milestoneId: "M",
        estimateHours: null,
        isTimeFixed: false,
        fixedDate: null,
        position: 1,
        priority: 1,
      },
    },
    tasks: {},
    taskDependencies: [],
    workPackageDependencies: [],
    currentPlan: {},
    dayMeta: {},
  };
}

function cfg(overrides: Partial<PlannerConfig> = {}): PlannerConfig {
  return {
    today,
    globalCapacityHoursPerDay: 3,
    horizonDays: 20,
    sameDayDependencies: true,
    allowTaskSplitting: false,
    objective: "min_disruption",
    ...overrides,
  };
}

describe("replan planner v1", () => {
  it("creates a valid baseline schedule within global and project capacity", () => {
    const state = baseState();
    state.projects.P!.capacityHoursPerDay = 2;
    state.projects.P2 = {
      id: "P2",
      goalId: "G",
      title: "Second",
      capacityHoursPerDay: 1.5,
      targetEndDate: null,
      position: 1,
      priority: 2,
    };
    state.workPackages.W3 = {
      id: "W3",
      projectId: "P2",
      title: "WP3",
      milestoneId: null,
      estimateHours: null,
      isTimeFixed: false,
      fixedDate: null,
      position: 0,
      priority: 1,
    };
    state.tasks = {
      A: task({ id: "A", workPackageId: "W1", estimateHours: 1 }),
      B: task({ id: "B", workPackageId: "W1", estimateHours: 1 }),
      C: task({ id: "C", workPackageId: "W3", estimateHours: 1.5 }),
    };

    const plan = planRoadmap(state, cfg({ globalCapacityHoursPerDay: 3 }));

    expect(plan.conflicts).toEqual([]);
    for (const [date, load] of Object.entries(plan.dayLoad)) {
      expect(load).toBeLessThanOrEqual(3);
      expect(plan.projectDayLoad[`P|${date}`] ?? 0).toBeLessThanOrEqual(2);
      expect(plan.projectDayLoad[`P2|${date}`] ?? 0).toBeLessThanOrEqual(1.5);
    }
  });

  it("allows same-day task dependencies and orders predecessor before successor", () => {
    const state = baseState();
    state.tasks = {
      A: task({ id: "A", workPackageId: "W1", estimateHours: 1, position: 0 }),
      B: task({ id: "B", workPackageId: "W1", estimateHours: 1, position: 1 }),
    };
    state.taskDependencies = [{ predecessorTaskId: "A", successorTaskId: "B" }];

    const plan = planRoadmap(state, cfg({ globalCapacityHoursPerDay: 2 }));
    expect(plan.dayItems[today]).toEqual(["A", "B"]);
  });

  it("rejects task dependencies across work packages", () => {
    const state = baseState();
    state.tasks = {
      A: task({ id: "A", workPackageId: "W1" }),
      B: task({ id: "B", workPackageId: "W2" }),
    };
    state.taskDependencies = [{ predecessorTaskId: "A", successorTaskId: "B" }];

    expect(() => planRoadmap(state, cfg())).toThrow(ApiError);
  });

  it("keeps successor work-package tasks behind predecessor work-package completion", () => {
    const state = baseState();
    state.projects.P!.capacityHoursPerDay = 2;
    state.tasks = {
      A: task({ id: "A", workPackageId: "W1", estimateHours: 2 }),
      B: task({ id: "B", workPackageId: "W2", estimateHours: 1 }),
    };
    state.workPackageDependencies = [{ predecessorWpId: "W1", successorWpId: "W2" }];

    const plan = planRoadmap(state, cfg({ globalCapacityHoursPerDay: 2 }));
    expect(plan.assignment.A).toBe(today);
    expect(plan.assignment.B).toBe("2026-06-20");
  });

  it("keeps existing future tasks on their dates when possible", () => {
    const state = baseState();
    state.tasks = {
      OLD: task({ id: "OLD", workPackageId: "W1", estimateHours: 1 }),
      NEW: task({ id: "NEW", workPackageId: "W1", estimateHours: 1 }),
    };
    state.currentPlan = { "2026-06-20": ["OLD"] };

    const plan = planRoadmap(state, cfg({ globalCapacityHoursPerDay: 2 }));
    expect(plan.assignment.OLD).toBe("2026-06-20");
    expect(plan.assignment.NEW).toBe(today);
  });

  it("uses a lower global capacity override for today only", () => {
    const state = baseState();
    state.projects.P!.capacityHoursPerDay = 2;
    state.tasks = {
      A: task({ id: "A", workPackageId: "W1", estimateHours: 1, position: 0 }),
      B: task({ id: "B", workPackageId: "W1", estimateHours: 1, position: 1 }),
    };

    const plan = planRoadmap(
      state,
      cfg({
        globalCapacityHoursPerDay: 2,
        globalCapacityHoursByDate: { [today]: 1 },
      }),
    );

    expect(plan.assignment.A).toBe(today);
    expect(plan.assignment.B).toBe("2026-06-20");
    expect(plan.dayLoad[today]).toBe(1);
  });

  it("keeps selected today work frozen under the remaining-capacity override", () => {
    const state = baseState();
    state.projects.P!.capacityHoursPerDay = 2;
    state.tasks = {
      KEEP: task({ id: "KEEP", workPackageId: "W1", estimateHours: 1, position: 0 }),
      MOVE: task({ id: "MOVE", workPackageId: "W1", estimateHours: 1, position: 1 }),
    };
    state.currentPlan = { [today]: ["KEEP", "MOVE"] };
    state.frozenTaskIds = ["KEEP"];

    const plan = planRoadmap(
      state,
      cfg({
        globalCapacityHoursPerDay: 2,
        globalCapacityHoursByDate: { [today]: 1 },
      }),
    );

    expect(plan.assignment.KEEP).toBe(today);
    expect(plan.assignment.MOVE).toBe("2026-06-20");
  });

  it("does not move locked day items and surfaces dependency conflicts", () => {
    const state = baseState();
    state.tasks = {
      A: task({ id: "A", workPackageId: "W1", estimateHours: 1 }),
      B: task({ id: "B", workPackageId: "W1", estimateHours: 1 }),
    };
    state.taskDependencies = [{ predecessorTaskId: "A", successorTaskId: "B" }];
    state.currentPlan = { [today]: ["B"] };
    state.dayMeta = { [today]: { isLocked: true, isConfirmed: true } };

    const plan = planRoadmap(state, cfg({ globalCapacityHoursPerDay: 1 }));
    expect(plan.assignment.B).toBe(today);
    expect(plan.conflicts.some((c) => c.type === "locked_day_dependency_conflict")).toBe(true);
  });

  it("large flexible tasks conflict without splitting", () => {
    const state = baseState();
    state.tasks = { BIG: task({ id: "BIG", workPackageId: "W1", estimateHours: 5 }) };

    const plan = planRoadmap(state, cfg({ globalCapacityHoursPerDay: 2 }));
    expect(plan.conflicts).toContainEqual(expect.objectContaining({ type: "task_too_large_for_daily_capacity" }));
  });

  it("large flexible tasks split into ordered capacity-sized virtual parts", () => {
    const state = baseState();
    state.tasks = { BIG: task({ id: "BIG", workPackageId: "W1", title: "Big Task", estimateHours: 5 }) };

    const plan = planRoadmap(state, cfg({ globalCapacityHoursPerDay: 2, allowTaskSplitting: true }));

    expect(plan.splitReport).toHaveLength(1);
    expect(plan.splitReport[0]!.parts.map((p) => p.hours)).toEqual([2, 2, 1]);
    expect(plan.assignment["BIG__part_1"]).toBe(today);
    expect(plan.assignment["BIG__part_2"]).toBe("2026-06-20");
    expect(plan.assignment["BIG__part_3"]).toBe("2026-06-21");
  });

  it("rewires dependencies around split tasks", () => {
    const state = baseState();
    state.tasks = {
      PREP: task({ id: "PREP", workPackageId: "W1", estimateHours: 1, position: 0 }),
      BIG: task({ id: "BIG", workPackageId: "W1", estimateHours: 5, position: 1 }),
      REVIEW: task({ id: "REVIEW", workPackageId: "W1", estimateHours: 1, position: 2 }),
    };
    state.taskDependencies = [
      { predecessorTaskId: "PREP", successorTaskId: "BIG" },
      { predecessorTaskId: "BIG", successorTaskId: "REVIEW" },
    ];

    const { expandedState } = expandStateForTaskSplitting(
      state,
      cfg({ globalCapacityHoursPerDay: 2, allowTaskSplitting: true }),
    );
    expect(expandedState.taskDependencies).toContainEqual({
      predecessorTaskId: "PREP",
      successorTaskId: "BIG__part_1",
    });
    expect(expandedState.taskDependencies).toContainEqual({
      predecessorTaskId: "BIG__part_3",
      successorTaskId: "REVIEW",
    });
    expect(expandedState.taskDependencies).toContainEqual({
      predecessorTaskId: "BIG__part_1",
      successorTaskId: "BIG__part_2",
    });
  });

  it("does not split large time-fixed tasks", () => {
    const state = baseState();
    state.tasks = {
      FIXED: task({
        id: "FIXED",
        workPackageId: "W1",
        estimateHours: 5,
        isTimeFixed: true,
        fixedDate: "2026-06-20",
      }),
    };

    const plan = planRoadmap(state, cfg({ globalCapacityHoursPerDay: 2, allowTaskSplitting: true }));
    expect(plan.splitReport).toEqual([]);
    expect(plan.conflicts).toContainEqual(
      expect.objectContaining({ type: "time_fixed_task_too_large_for_daily_capacity" }),
    );
  });

  it("proposal diff detects moves, insertions, milestone impacts, and goal impacts", () => {
    const state = baseState();
    state.projects.P!.capacityHoursPerDay = 1;
    state.tasks = {
      OLD: task({ id: "OLD", workPackageId: "W1", estimateHours: 1, position: 1 }),
      FIXED: task({
        id: "FIXED",
        workPackageId: "W1",
        estimateHours: 1,
        isTimeFixed: true,
        fixedDate: today,
        position: 0,
      }),
    };
    state.currentPlan = { [today]: ["OLD"] };

    const plan = planRoadmap(state, cfg({ globalCapacityHoursPerDay: 1 }));
    const diff = createProposalDiff(state, plan);

    expect(diff.moves).toContainEqual(expect.objectContaining({ task_id: "OLD", from_date: today, to_date: "2026-06-20" }));
    expect(diff.insertions).toContainEqual(expect.objectContaining({ task_id: "FIXED", to_date: today }));
    expect(diff.milestone_impacts).toHaveLength(1);
    expect(diff.goal_impacts).toHaveLength(1);
  });

  it("schedules a tighter-deadline project ahead of a looser one under shared capacity", () => {
    const state = baseState();
    state.projects.P!.capacityHoursPerDay = 1; // P has no deadline
    state.projects.P2 = {
      id: "P2",
      goalId: "G",
      title: "Urgent",
      capacityHoursPerDay: 1,
      targetEndDate: today, // P2 is due today ⇒ higher deadline pressure
      position: 1,
      priority: 2,
    };
    state.workPackages.W3 = {
      id: "W3",
      projectId: "P2",
      title: "WP3",
      milestoneId: null,
      estimateHours: null,
      isTimeFixed: false,
      fixedDate: null,
      position: 0,
      priority: 1,
    };
    state.tasks = {
      A: task({ id: "A", workPackageId: "W1", estimateHours: 1 }), // P (looser)
      C: task({ id: "C", workPackageId: "W3", estimateHours: 1 }), // P2 (urgent)
    };

    // Global capacity 1 ⇒ only one task fits today; the urgent project should win it,
    // even though P sorts first by position.
    const plan = planRoadmap(state, cfg({ globalCapacityHoursPerDay: 1 }));
    expect(plan.assignment.C).toBe(today);
    expect(plan.assignment.A).toBe("2026-06-20");
  });

  it("proposes minimal extra capacity to pull a project back onto its deadline", () => {
    const state = baseState();
    state.projects.P!.capacityHoursPerDay = 1;
    state.projects.P!.targetEndDate = "2026-06-20"; // today + 1
    state.tasks = {
      A: task({ id: "A", workPackageId: "W1", estimateHours: 1 }),
      B: task({ id: "B", workPackageId: "W1", estimateHours: 1 }),
      C: task({ id: "C", workPackageId: "W1", estimateHours: 1 }),
    };

    // 3×1h at 1h/day finishes 2026-06-21 — one day late. The repair loop adds exactly
    // 1h of capacity (on the day nearest the deadline) so all three fit by 06-20.
    const plan = planRoadmap(state, cfg({ globalCapacityHoursPerDay: 8 }));

    const proposal = plan.capacityProposals.find((p) => p.projectId === "P");
    expect(proposal).toBeDefined();
    expect(proposal!.normalProjectedDate).toBe("2026-06-21");
    expect(proposal!.proposedProjectedDate).toBe("2026-06-20");
    const totalExtra = proposal!.requiredExtraCapacity.reduce(
      (sum, d) => sum + d.proposedExtraProjectHours,
      0,
    );
    expect(totalExtra).toBeCloseTo(1, 5); // minimal: removing any 0.5h misses the deadline
    expect(plan.deadlineResults.find((r) => r.projectId === "P")!.satisfied).toBe(true);
    expect(plan.assignment.C! <= "2026-06-20").toBe(true);
  });

  it("reports an infeasible_plan conflict when no allowed extra capacity can meet the deadline", () => {
    const state = baseState();
    state.projects.P!.capacityHoursPerDay = 1;
    state.projects.P!.targetEndDate = today; // only today is eligible
    state.tasks = {};
    for (const id of ["A", "B", "C", "D", "E", "F"]) {
      state.tasks[id] = task({ id, workPackageId: "W1", estimateHours: 1 });
    }

    // 6h due today, but project capacity 1h/day + max 4h/day extra = 5h ⇒ impossible.
    const plan = planRoadmap(state, cfg({ globalCapacityHoursPerDay: 12 }));
    expect(
      plan.conflicts.some((c) => c.type === "infeasible_plan" && c.project_id === "P"),
    ).toBe(true);
    expect(plan.deadlineResults.find((r) => r.projectId === "P")!.satisfied).toBe(false);
  });
});
