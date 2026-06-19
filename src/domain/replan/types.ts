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
  task_title?: string;
  original_task_id?: string | null;
  split_index?: number | null;
  split_count?: number | null;
  delta_days?: number | null;
}

/**
 * Milestone projection shift, for the review UI. `to_projected_date` is computed by
 * the shared projection helper (`projectMilestoneDates`) — the SAME source GET
 * /roadmap and the flow diagram use, so a milestone's date is consistent everywhere.
 *
 * projected_date is ALWAYS derived (data-model §6), NEVER stored: there is no
 * `milestone.projected_date` column and apply writes nothing here. Do not cache it
 * into a column later — that reintroduces exactly the two-sources-of-truth drift §6
 * exists to avoid.
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
  type?: string;
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
  insertions?: unknown[];
  removed_or_unplanned?: unknown[];
  unchanged_task_ids?: string[];
  goal_impacts?: unknown[];
  planning_conflicts?: unknown[];
  warnings?: string[];
  split_report?: SplitReport[];
  split_task_id_map?: Record<string, string>;
  /** Present only on edited approval, authorizing time-fixed moves (invariant #4). */
  time_fixed_resolutions?: TimeFixedResolution[];
}

export interface SplitPart {
  task_id: string;
  title: string;
  hours: number;
  to_date?: string | null;
}

export interface SplitReport {
  original_task_id: string;
  original_title: string;
  original_hours: number;
  max_chunk_hours: number;
  split_count: number;
  parts: SplitPart[];
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

function optNum(v: unknown, field: string): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw badRequest(`${field} must be a number or null`);
  }
  return v;
}

function optString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function parseSplitReport(input: unknown): SplitReport[] {
  if (input == null) return [];
  if (!Array.isArray(input)) throw badRequest("edits.split_report must be an array");
  return input.map((r, i) => {
    if (!isObj(r) || typeof r.original_task_id !== "string") {
      throw badRequest(`edits.split_report[${i}].original_task_id is required`);
    }
    if (!Array.isArray(r.parts)) throw badRequest(`edits.split_report[${i}].parts must be an array`);
    return {
      original_task_id: r.original_task_id,
      original_title: typeof r.original_title === "string" ? r.original_title : "",
      original_hours: typeof r.original_hours === "number" ? r.original_hours : 0,
      max_chunk_hours: typeof r.max_chunk_hours === "number" ? r.max_chunk_hours : 0,
      split_count: typeof r.split_count === "number" ? r.split_count : r.parts.length,
      parts: r.parts.map((p, j) => {
        if (!isObj(p) || typeof p.task_id !== "string") {
          throw badRequest(`edits.split_report[${i}].parts[${j}].task_id is required`);
        }
        return {
          task_id: p.task_id,
          title: typeof p.title === "string" ? p.title : p.task_id,
          hours: typeof p.hours === "number" ? p.hours : 0,
          to_date: optDate(p.to_date, `edits.split_report[${i}].parts[${j}].to_date`),
        };
      }),
    };
  });
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
      task_title: optString(m.task_title),
      original_task_id:
        m.original_task_id === undefined || m.original_task_id === null
          ? (m.original_task_id as null | undefined)
          : typeof m.original_task_id === "string"
            ? m.original_task_id
            : undefined,
      split_index: optNum(m.split_index, `edits.moves[${i}].split_index`) ?? undefined,
      split_count: optNum(m.split_count, `edits.moves[${i}].split_count`) ?? undefined,
      delta_days: optNum(m.delta_days, `edits.moves[${i}].delta_days`) ?? undefined,
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
  const split_report = parseSplitReport(input.split_report);
  const warnings =
    Array.isArray(input.warnings) && input.warnings.every((w) => typeof w === "string")
      ? (input.warnings as string[])
      : undefined;

  return {
    moves,
    milestone_impacts,
    time_fixed_conflicts,
    time_fixed_resolutions,
    insertions: Array.isArray(input.insertions) ? input.insertions : undefined,
    removed_or_unplanned: Array.isArray(input.removed_or_unplanned)
      ? input.removed_or_unplanned
      : undefined,
    unchanged_task_ids: Array.isArray(input.unchanged_task_ids)
      ? (input.unchanged_task_ids.filter((id) => typeof id === "string") as string[])
      : undefined,
    goal_impacts: Array.isArray(input.goal_impacts) ? input.goal_impacts : undefined,
    planning_conflicts: Array.isArray(input.planning_conflicts) ? input.planning_conflicts : undefined,
    warnings,
    split_report,
    split_task_id_map: isObj(input.split_task_id_map)
      ? (input.split_task_id_map as Record<string, string>)
      : undefined,
  };
}
