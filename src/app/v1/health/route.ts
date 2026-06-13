/** GET /v1/health — liveness probe (no auth, no DB). */
import { handler, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async () => json({ status: "ok" }));
