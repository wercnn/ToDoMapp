/**
 * Cron authentication — the ONE request surface outside the JWT tenancy model.
 * `/v1/jobs/tick` is hit by Vercel Cron (which sends `Authorization: Bearer
 * $CRON_SECRET`), not by a user, so it carries no JWT and resolves no workspace from
 * its caller. It must be airtight: treat the secret with the same care as token
 * verification.
 *
 *   - Constant-time comparison (no early-exit on first mismatched byte).
 *   - Fail CLOSED: a missing env secret, a missing header, or a wrong value all
 *     throw 401 — the route never proceeds without a verified match.
 *   - The route takes NO user/workspace id from the caller; it only ever acts on
 *     users returned by its own server-side scan.
 */
import { timingSafeEqual } from "node:crypto";
import { unauthenticated } from "../lib/errors";

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // timingSafeEqual requires equal lengths; a length mismatch is a guaranteed
  // non-match, but still run a fixed compare so we don't leak via early return.
  if (ab.length !== bb.length) {
    timingSafeEqual(bb, bb);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** Throw 401 unless the request carries the configured cron secret. Fails closed. */
export function assertCronSecret(req: Request): void {
  const expected = process.env.CRON_SECRET;
  if (!expected) throw unauthenticated("Cron is not configured");

  const header = req.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : header;
  if (!constantTimeEquals(provided, expected)) {
    throw unauthenticated("Invalid cron credentials");
  }
}
