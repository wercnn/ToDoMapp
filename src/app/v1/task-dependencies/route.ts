/**
 * POST /v1/task-dependencies — create a task→task "must finish before" edge (api §9).
 * Rejects self-dependency (422), duplicate edge (409, PK), and any cycle (409).
 */
import { handler, json, readJson } from "@/lib/http";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import {
  createTaskDependency,
  type CreateTaskDependencyInput,
} from "@/domain/dependencies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  const body = await readJson<CreateTaskDependencyInput>(req);
  const edge = await createTaskDependency(getDb(), ctx, body);
  return json(edge, 201);
});
