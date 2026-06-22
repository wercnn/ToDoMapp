/**
 * GET  /v1/projects/{projectId}/work-packages  — list (filters: milestone_id, open)
 * POST /v1/projects/{projectId}/work-packages  — create a work package
 *
 * Create returns `{ work_package }`; replanning after mid-flight additions is manual.
 */
import { handler, json, readJson } from "@/lib/http";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import {
  createWorkPackage,
  listWorkPackages,
  type CreateWorkPackageInput,
} from "@/domain/workPackages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { projectId } = await context.params;
  const params = new URL(req.url).searchParams;
  const workPackages = await listWorkPackages(getDb(), ctx, projectId, {
    milestoneId: params.get("milestone_id") ?? undefined,
    openOnly: params.get("open") === "true",
  });
  return json(workPackages);
});

export const POST = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { projectId } = await context.params;
  const body = await readJson<CreateWorkPackageInput>(req);
  const result = await createWorkPackage(getDb(), ctx, projectId, body);
  return json(result, 201);
});
