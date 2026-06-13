/**
 * App-layer validation for the rules the DB also enforces via CHECK constraints.
 * Doing it here lets us return the precise 422 the API contract promises
 * (either/or estimation, time-fixed pairing) instead of a generic DB error, and
 * documents intent at the call site. The DB CHECKs remain the backstop.
 */
import type { DifficultyLevel } from "../db/types";
import { badRequest, unprocessable } from "../lib/errors";
import { isValidDateString } from "../lib/dates";

export interface EstimateInput {
  estimate_hours?: number | null;
  difficulty?: DifficultyLevel | null;
}

export interface TimeFixedInput {
  is_time_fixed?: boolean;
  fixed_date?: string | null;
}

const DIFFICULTIES: DifficultyLevel[] = ["low", "mid", "high"];

/** Either/or estimation (Decision #13): hours XOR difficulty, or neither. */
export function validateEstimate(input: EstimateInput): void {
  const hasHours = input.estimate_hours != null;
  const hasDifficulty = input.difficulty != null;
  if (hasHours && hasDifficulty) {
    throw unprocessable("Provide estimate_hours OR difficulty, not both");
  }
  if (hasHours && !(input.estimate_hours! > 0)) {
    throw unprocessable("estimate_hours must be > 0");
  }
  if (hasDifficulty && !DIFFICULTIES.includes(input.difficulty!)) {
    throw badRequest("difficulty must be one of low | mid | high");
  }
}

/** Time-fixed pairing: is_time_fixed === (fixed_date is set). */
export function validateTimeFixed(input: TimeFixedInput): void {
  const isFixed = input.is_time_fixed === true;
  const hasDate = input.fixed_date != null;
  if (isFixed !== hasDate) {
    throw unprocessable(
      "is_time_fixed must be true exactly when fixed_date is provided",
    );
  }
  if (hasDate && !isValidDateString(input.fixed_date!)) {
    throw badRequest("fixed_date must be a valid YYYY-MM-DD date");
  }
}

/** Non-empty title after trim (mirrors the DB CHECK). */
export function validateTitle(title: unknown): string {
  if (typeof title !== "string" || title.trim().length === 0) {
    throw badRequest("title is required and must be non-empty");
  }
  return title;
}
