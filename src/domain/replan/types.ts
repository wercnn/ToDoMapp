/**
 * The replan diff (the JSONB stored in `replan_proposal.changes`). This is a
 * *transient draft* — relational truth only changes when an approved diff is
 * applied (data-model §4.5 design note). Keeping it as a typed shape here lets
 * the analyze/apply steps stay honest about what they produce and consume.
 *
 * Structural guarantee (the best property in this design): a GENERATED proposal
 * NEVER puts a time-fixed task in `moves` — time-fixed work surfaces only in
 * `time_fixed_conflicts`. The apply guard (invariant #4) is the second wall: even
 * a hand-edited diff that moves a time-fixed task is rejected unless it carries an
 * explicit `time_fixed_resolutions` choice.
 */
import { badRequest } from "../../lib/errors";
import { isValidDateString } from "../../lib/dates";

/** A per-item move. `from_date=null` ⇒ newly scheduled; `to_date=null` ⇒ descheduled. */
export interface Move {
  task_id: string;
  from_date: string | null;
  to_date: string | null;
}

/**
 * Milestone projection shift. DESCRIPTIVE ONLY in Phase 4 — there is no persisted
 * `projected_date` column yet (deferred to Phase 6), so apply writes nothing to
 * `milestone` from this. These are display projections for the review UI, not
 * committed state.
 */
export interface MilestoneImpact {
  milestone_id: string;
  title: string;
  from_projected_date: string | null;
  to_projected_date: string | null;
}

export type TimeFixedOption = "prioritize" | "descope" | "renegotiate";
const TIME_FIXED_OPTIONS: TimeFixedOption[] = ["prioritize", "descope", "renegotiate"];

/** A time-fixed commitment at risk. Surfaced separately, never auto-moved (Decision #7). */
export interface TimeFixedConflict {
  task_id: string;
  fixed_date: string | null;
  reason: string;
  options: TimeFixedOption[];
}

/** The user's explicit choice for a time-fixed conflict, supplied on edited approval. */
export interface TimeFixedResolution {
  task_id: string;
  choice: TimeFixedOption;
  /** Required iff `choice='renegotiate'` — the new committed date. */
  new_fixed_date?: string | null;
}

export interface Changes {
  moves: Move[];
  milestone_impacts: MilestoneImpact[];
  time_fixed_conflicts: TimeFixedConflict[];
  /** Present only on edited approval, authorizing time-fixed moves (invariant #4). */
  time_fixed_resolutions?: TimeFixedResolution[];
}

export function emptyChanges(): Changes {
  return { moves: [], milestone_impacts: [], time_fixed_conflicts: [] };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function optDate(v: unknown, field: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string" || !isValidDateString(v)) {
    throw badRequest(`${field} must be a 'YYYY-MM-DD' date or null`);
  }
  return v;
}

/**
 * Validate a client-supplied `edits` payload into a `Changes`. Used on edited
 * approval — never trust the shape coming off the wire. Only the fields apply
 * reads are validated strictly; `milestone_impacts` is display-only so it's
 * passed through leniently.
 */
export function parseChanges(input: unknown): Changes {
  if (!isObj(input)) throw badRequest("edits must be an object");

  const movesIn = input.moves ?? [];
  if (!Array.isArray(movesIn)) throw badRequest("edits.moves must be an array");
  const moves: Move[] = movesIn.map((m, i) => {
    if (!isObj(m) || typeof m.task_id !== "string") {
      throw badRequest(`edits.moves[${i}].task_id is required`);
    }
    return {
      task_id: m.task_id,
      from_date: optDate(m.from_date, `edits.moves[${i}].from_date`),
      to_date: optDate(m.to_date, `edits.moves[${i}].to_date`),
    };
  });

  const resIn = input.time_fixed_resolutions ?? [];
  if (!Array.isArray(resIn)) {
    throw badRequest("edits.time_fixed_resolutions must be an array");
  }
  const time_fixed_resolutions: TimeFixedResolution[] = resIn.map((r, i) => {
    if (!isObj(r) || typeof r.task_id !== "string") {
      throw badRequest(`edits.time_fixed_resolutions[${i}].task_id is required`);
    }
    if (!TIME_FIXED_OPTIONS.includes(r.choice as TimeFixedOption)) {
      throw badRequest(
        `edits.time_fixed_resolutions[${i}].choice must be one of ${TIME_FIXED_OPTIONS.join(", ")}`,
      );
    }
    return {
      task_id: r.task_id,
      choice: r.choice as TimeFixedOption,
      new_fixed_date: optDate(r.new_fixed_date, `edits.time_fixed_resolutions[${i}].new_fixed_date`),
    };
  });

  const conflictsIn = input.time_fixed_conflicts;
  const time_fixed_conflicts: TimeFixedConflict[] = Array.isArray(conflictsIn)
    ? (conflictsIn as TimeFixedConflict[])
    : [];
  const impactsIn = input.milestone_impacts;
  const milestone_impacts: MilestoneImpact[] = Array.isArray(impactsIn)
    ? (impactsIn as MilestoneImpact[])
    : [];

  return { moves, milestone_impacts, time_fixed_conflicts, time_fixed_resolutions };
}
