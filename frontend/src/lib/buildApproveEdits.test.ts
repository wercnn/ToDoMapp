/**
 * The contract test for the F3 keystone. Shape correctness is the whole game — a
 * wrong `edits` body silently corrupts the plan — so we assert the EXACT object for
 * every case against what apply.ts consumes.
 */
import { describe, expect, it } from "vitest";
import type { ReplanChanges, TimeFixedConflict } from "@api-types";
import { allConflictsResolved, buildApproveEdits } from "./buildApproveEdits";

const regularMove = { task_id: "task-A", from_date: "2026-06-20", to_date: "2026-06-23" };
const milestoneImpact = {
  milestone_id: "ms-1",
  title: "Beta",
  from_projected_date: "2026-06-25",
  to_projected_date: "2026-06-28",
};
const tfConflict: TimeFixedConflict = {
  task_id: "task-TF",
  fixed_date: "2026-06-25",
  reason: "over capacity",
  options: ["prioritize", "descope", "renegotiate"],
};

function changes(over: Partial<ReplanChanges> = {}): ReplanChanges {
  return {
    moves: [regularMove],
    milestone_impacts: [milestoneImpact],
    time_fixed_conflicts: [],
    ...over,
  };
}

describe("buildApproveEdits", () => {
  it("regular-only, all moves kept → plain approve (no edits body)", () => {
    const result = buildApproveEdits({ changes: changes(), decisions: {} });
    expect(result).toEqual({ edited: false });
  });

  it("with-uncheck (no conflicts) → edited, original moves minus the excluded one", () => {
    const result = buildApproveEdits({
      changes: changes(),
      excludedMoveTaskIds: new Set(["task-A"]),
      decisions: {},
    });
    expect(result).toEqual({
      edited: true,
      edits: {
        moves: [],
        milestone_impacts: [milestoneImpact],
        time_fixed_conflicts: [],
        time_fixed_resolutions: [],
      },
    });
  });

  it("+descope → carries original moves AND appends a null-target move + resolution", () => {
    const result = buildApproveEdits({
      changes: changes({ time_fixed_conflicts: [tfConflict] }),
      decisions: { "task-TF": { choice: "descope" } },
    });
    expect(result).toEqual({
      edited: true,
      edits: {
        moves: [
          regularMove,
          { task_id: "task-TF", from_date: "2026-06-25", to_date: null },
        ],
        milestone_impacts: [milestoneImpact],
        time_fixed_conflicts: [tfConflict],
        time_fixed_resolutions: [{ task_id: "task-TF", choice: "descope" }],
      },
    });
  });

  it("+renegotiate → move to the new date + resolution carrying new_fixed_date", () => {
    const result = buildApproveEdits({
      changes: changes({ time_fixed_conflicts: [tfConflict] }),
      decisions: { "task-TF": { choice: "renegotiate", new_fixed_date: "2026-07-02" } },
    });
    expect(result).toEqual({
      edited: true,
      edits: {
        moves: [
          regularMove,
          { task_id: "task-TF", from_date: "2026-06-25", to_date: "2026-07-02" },
        ],
        milestone_impacts: [milestoneImpact],
        time_fixed_conflicts: [tfConflict],
        time_fixed_resolutions: [
          { task_id: "task-TF", choice: "renegotiate", new_fixed_date: "2026-07-02" },
        ],
      },
    });
  });

  it("+prioritize → NO appended move, resolution only (audit trail)", () => {
    const result = buildApproveEdits({
      changes: changes({ time_fixed_conflicts: [tfConflict] }),
      decisions: { "task-TF": { choice: "prioritize" } },
    });
    expect(result).toEqual({
      edited: true,
      edits: {
        moves: [regularMove],
        milestone_impacts: [milestoneImpact],
        time_fixed_conflicts: [tfConflict],
        time_fixed_resolutions: [{ task_id: "task-TF", choice: "prioritize" }],
      },
    });
  });

  it("throws if a surfaced conflict has no decision (button gate is the real guard)", () => {
    expect(() =>
      buildApproveEdits({ changes: changes({ time_fixed_conflicts: [tfConflict] }), decisions: {} }),
    ).toThrow(/every time-fixed conflict/);
  });

  it("allConflictsResolved reflects coverage", () => {
    expect(allConflictsResolved([tfConflict], {})).toBe(false);
    expect(allConflictsResolved([tfConflict], { "task-TF": { choice: "prioritize" } })).toBe(true);
    expect(allConflictsResolved([], {})).toBe(true);
  });
});
