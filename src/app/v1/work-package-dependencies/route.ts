/**
 * POST /v1/work-package-dependencies — create a WP→WP "must finish before" edge
 * (api §9). Same validation set as task edges: self (422), duplicate (409), cycle (409).
 */
import { handler, json, readJson } from "@/lib/http";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import {
  createWorkPackageDependency,
  type CreateWorkPackageDependencyInput,
} from "@/domain/dependencies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  const body = await readJson<CreateWorkPackageDependencyInput>(req);
  const edge = await createWorkPackageDependency(getDb(), ctx, body);
  return json(edge, 201);
});
