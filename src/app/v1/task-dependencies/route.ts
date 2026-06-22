/**
 * POST /v1/task-dependencies — create legacy task-edge metadata (api §9).
 * Task scheduling, blocked-state, and flow edges use position inside the work package.
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
