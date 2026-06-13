/**
 * API error taxonomy (api-endpoints.md §1 Errors):
 *   400 malformed input · 401 unauthenticated · 404 not found / not in workspace
 *   409 state conflict (cycle, duplicate edge, double-plan, wrong transition)
 *   422 invariant violation (either/or estimation, time-fixed pairing, moving
 *       time-fixed work, scheduling a blocked task)
 *
 * Cross-workspace access is surfaced as 404 (never 403) so a caller can't probe
 * which ids exist outside their workspace (api §1 Tenancy).
 */
export type ApiErrorStatus = 400 | 401 | 404 | 409 | 422;

export class ApiError extends Error {
  readonly status: ApiErrorStatus;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: ApiErrorStatus, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, "bad_request", message, details);

export const unauthenticated = (message = "Missing or invalid credentials") =>
  new ApiError(401, "unauthenticated", message);

/** Not found OR not in the caller's workspace — deliberately indistinguishable. */
export const notFound = (message = "Not found") => new ApiError(404, "not_found", message);

export const conflict = (message: string, details?: unknown) =>
  new ApiError(409, "conflict", message, details);

export const unprocessable = (message: string, details?: unknown) =>
  new ApiError(422, "unprocessable", message, details);

/** Postgres error shape we care about for mapping constraint violations. */
interface PgError {
  code?: string;
  constraint?: string;
  detail?: string;
}

/**
 * Map a raw Postgres error to an ApiError where it represents a meaningful API
 * conflict/invariant. Falls through (returns null) for anything unrecognised so
 * the caller surfaces a generic 500.
 */
export function mapDbError(err: unknown): ApiError | null {
  const e = err as PgError;
  switch (e?.code) {
    case "23505": // unique_violation — duplicate edge, double-plan, double-award
      return conflict("Resource already exists or conflicts with an existing row", {
        constraint: e.constraint,
      });
    case "23514": // check_violation — invariant breach (either/or, time-fixed pairing…)
      return unprocessable("A data invariant was violated", { constraint: e.constraint });
    case "23503": // foreign_key_violation — references a row not in this workspace
      return notFound("Referenced resource not found");
    case "23502": // not_null_violation
      return badRequest("A required field was missing", { constraint: e.constraint });
    default:
      return null;
  }
}
