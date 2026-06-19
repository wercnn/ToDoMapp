/**
 * buildApproveEdits — the F3 keystone. Turns the review UI's state (the proposal's
 * original diff + which moves the user kept + the per-time-fixed-conflict decision)
 * into the EXACT `edits` body that `POST /replan-proposals/{id}/approve` expects,
 * which `src/domain/replan/apply.ts` consumes.
 *
 * Why this matters: on approve, `edits` REPLACES the stored `changes` entirely
 * (proposals.ts → `effective = editChanges`), it does NOT merge. So the edited diff
 * MUST re-carry the original (non-time-fixed) moves, or those regular reschedules
 * are silently dropped.
 *
 * The structural guarantee (Principle 1, like F2's discriminated unions): a move for
 * a time-fixed task is ONLY ever produced here, alongside its resolution. They are
 * built together from one `TimeFixedDecision`, so apply's guard #4 (time-fixed task
 * in `moves` without a resolution → 422) can never trip from a UI-built body.
 *
 * Per-decision → diff mapping (mirrors apply.ts line-for-line):
 *  - prioritize  → NO move (commitment stays put; apply would skip it anyway) +
 *                  a resolution recorded for the audit trail (applied_changes).
 *  - descope     → move { from_date: fixed_date, to_date: null } + resolution. apply
 *                  defers the old item, no successor.
 *  - renegotiate → move { from_date: fixed_date, to_date: new_fixed_date } +
 *                  resolution carrying new_fixed_date. apply updates task.fixed_date
 *                  and inserts on the new date.
 *
 * from_date = the conflict's fixed_date (where the commitment currently sits). If no
 * planned item is materialized there, apply's defer step is a guarded UPDATE that
 * no-ops — safe; renegotiate still updates the task + inserts correctly.
 */
import type {
  ReplanChanges,
  ReplanMove,
  TimeFixedConflict,
  TimeFixedResolution,
} from "@api-types";

/**
 * The per-conflict choice as a discriminated union: `renegotiate` cannot be
 * constructed without `new_fixed_date`, so "renegotiate with no date" is
 * unrepresentable (the F2-style structural guarantee).
 */
export type TimeFixedDecision =
  | { choice: "prioritize" }
  | { choice: "descope" }
  | { choice: "renegotiate"; new_fixed_date: string };

export interface BuildApproveInput {
  /** The proposal's original diff (as returned by GET /replan-proposals/{id}). */
  changes: ReplanChanges;
  /** Task ids of original moves the user UNCHECKED (excluded from the apply). */
  excludedMoveTaskIds?: ReadonlySet<string>;
  /** One decision per surfaced time-fixed conflict, keyed by task_id. */
  decisions: Readonly<Record<string, TimeFixedDecision>>;
}

export type BuildApproveResult =
  /** No conflicts and no unchecked moves → plain approve (apply the stored diff). */
  | { edited: false }
  /** Edited approve → send these `edits` (full replacement of the stored diff). */
  | { edited: true; edits: ReplanChanges };

/** Every surfaced conflict has a decision? The Approve button's enabled-gate. */
export function allConflictsResolved(
  conflicts: TimeFixedConflict[],
  decisions: Readonly<Record<string, TimeFixedDecision>>,
): boolean {
  return conflicts.every((c) => decisions[c.task_id] !== undefined);
}

export function buildApproveEdits(input: BuildApproveInput): BuildApproveResult {
  const { changes } = input;
  const excluded = input.excludedMoveTaskIds ?? new Set<string>();
  const conflicts = changes.time_fixed_conflicts ?? [];

  const hasConflicts = conflicts.length > 0;
  const hasExclusions = (changes.moves ?? []).some((m) => excluded.has(m.task_id));

  // Plain approve: nothing the user touched changes the stored diff.
  if (!hasConflicts && !hasExclusions) return { edited: false };

  if (!allConflictsResolved(conflicts, input.decisions)) {
    // The UI gates the Approve button on this; reaching here is a programming error.
    throw new Error("buildApproveEdits: every time-fixed conflict must have a decision");
  }

  // (1) Original moves minus the ones the user unchecked.
  const moves: ReplanMove[] = (changes.moves ?? []).filter((m) => !excluded.has(m.task_id));

  // (2) + (3) One pass over conflicts: append a move (descope/renegotiate) and always
  // a resolution. prioritize emits a resolution but no move.
  const time_fixed_resolutions: TimeFixedResolution[] = [];
  for (const c of conflicts) {
    const d = input.decisions[c.task_id];
    if (!d) throw new Error("buildApproveEdits: every time-fixed conflict must have a decision");
    if (d.choice === "descope") {
      moves.push({ task_id: c.task_id, from_date: c.fixed_date, to_date: null });
      time_fixed_resolutions.push({ task_id: c.task_id, choice: "descope" });
    } else if (d.choice === "renegotiate") {
      moves.push({ task_id: c.task_id, from_date: c.fixed_date, to_date: d.new_fixed_date });
      time_fixed_resolutions.push({
        task_id: c.task_id,
        choice: "renegotiate",
        new_fixed_date: d.new_fixed_date,
      });
    } else {
      time_fixed_resolutions.push({ task_id: c.task_id, choice: "prioritize" });
    }
  }

  return {
    edited: true,
    edits: {
      ...changes,
      moves,
      // (4) display-only sections passed through verbatim for a faithful applied_changes.
      milestone_impacts: changes.milestone_impacts ?? [],
      time_fixed_conflicts: conflicts,
      time_fixed_resolutions,
    },
  };
}
