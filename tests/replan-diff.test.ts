/**
 * Pure unit tests for the replan diff producer (`computeDiff`). No DB. These pin
 * the STRUCTURAL guarantee: a time-fixed task is NEVER emitted into `moves`.
 */
import { describe, expect, it } from "vitest";
import { computeDiff, type BaselineItem } from "@/domain/replan/analyze";
import type { DraftDay } from "@/planner/types";

describe("computeDiff", () => {
  it("emits a move when a flexible task shifts to a new day", () => {
    const baseline: BaselineItem[] = [{ taskId: "T1", planDate: "2026-06-15" }];
    const target: DraftDay[] = [{ planDate: "2026-06-16", items: [{ taskId: "T1", projectId: "P" }] }];
    const moves = computeDiff(baseline, target, new Set());
    expect(moves).toEqual([{ task_id: "T1", from_date: "2026-06-15", to_date: "2026-06-16" }]);
  });

  it("emits no move when a task stays on the same day", () => {
    const baseline: BaselineItem[] = [{ taskId: "T1", planDate: "2026-06-15" }];
    const target: DraftDay[] = [{ planDate: "2026-06-15", items: [{ taskId: "T1", projectId: "P" }] }];
    expect(computeDiff(baseline, target, new Set())).toEqual([]);
  });

  it("from_date=null for a newly scheduled task; to_date=null for a descheduled one", () => {
    const baseline: BaselineItem[] = [{ taskId: "GONE", planDate: "2026-06-15" }];
    const target: DraftDay[] = [{ planDate: "2026-06-16", items: [{ taskId: "NEW", projectId: "P" }] }];
    const moves = computeDiff(baseline, target, new Set());
    expect(moves).toContainEqual({ task_id: "NEW", from_date: null, to_date: "2026-06-16" });
    expect(moves).toContainEqual({ task_id: "GONE", from_date: "2026-06-15", to_date: null });
  });

  it("NEVER emits a time-fixed task into moves, even when its placement differs", () => {
    const baseline: BaselineItem[] = [{ taskId: "TF", planDate: "2026-06-15" }];
    // The planner placed the pinned task on a different date — still never a move.
    const target: DraftDay[] = [{ planDate: "2026-06-17", items: [{ taskId: "TF", projectId: "P" }] }];
    const moves = computeDiff(baseline, target, new Set(["TF"]));
    expect(moves).toEqual([]);
  });
});
