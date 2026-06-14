/**
 * GET /v1/point-events — scoring history (api §12). Append-only ledger READ;
 * filters: from? / to? (local-day bounds) / event_type?. No mutation endpoint —
 * scoring happens only in the completion cascade (§8).
 */
import { handler, json } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { listPointEvents } from "@/domain/points";
import { isValidDateString } from "@/lib/dates";
import type { PointEventType } from "@/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENT_TYPES: PointEventType[] = [
  "task_completed",
  "daily_goal_completed",
  "milestone_achieved",
];

export const GET = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  const eventType = url.searchParams.get("event_type") ?? undefined;

  if (from && !isValidDateString(from)) throw badRequest("from must be YYYY-MM-DD");
  if (to && !isValidDateString(to)) throw badRequest("to must be YYYY-MM-DD");
  if (eventType && !EVENT_TYPES.includes(eventType as PointEventType)) {
    throw badRequest("event_type is not a recognised point event type");
  }

  const events = await listPointEvents(getDb(), ctx, {
    from,
    to,
    eventType: eventType as PointEventType | undefined,
  });
  return json(events);
});
