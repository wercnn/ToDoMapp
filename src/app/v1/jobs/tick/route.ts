/**
 * POST/GET /v1/jobs/tick — the single periodic background-jobs tick (api §13).
 *
 * Invoked by Vercel Cron (daily on Hobby — see vercel.json + PROGRESS.md "Open
 * items"; the design wants ~15 min, restored on Pro or via an external scheduler).
 * Can also be triggered manually with the CRON_SECRET. NOT part of the JWT
 * tenancy model: guarded solely by a constant-time `CRON_SECRET` check that fails
 * closed, and it accepts NO user/workspace id from the caller — it acts only on
 * users its own server-side scan returns. Vercel Cron issues GET, so both verbs map
 * to the same handler.
 */
import { assertCronSecret } from "@/auth/cron";
import { getDb } from "@/db/kysely";
import { runTick } from "@/domain/jobs/runner";
import { handler, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tick = handler(async (req: Request) => {
  assertCronSecret(req);
  const result = await runTick(getDb());
  return json(result);
});

export const GET = tick;
export const POST = tick;
