/**
 * Map a thrown error to a calm, human inline message (design Principle 3 — never
 * alarm the user). Reuses the F1 ApiError envelope; adds friendlier wording for
 * the onboarding-relevant validation codes so a 422/409 reads as guidance, not a
 * failure. Falls back to the server message, then a generic line.
 */
import { ApiError } from "@/api/client";

export function calmMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "unprocessable": // either/or estimation, time-fixed pairing, capacity range, blocked task
      case "bad_request":
        return err.message || "Please check that field and try again.";
      case "conflict": // dependency cycle, duplicate edge, day not in proposed state
        return err.message || "That conflicts with something already there.";
      default:
        return err.message || `Request failed (${err.status}).`;
    }
  }
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}
