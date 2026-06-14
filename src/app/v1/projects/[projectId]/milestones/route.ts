/**
 * GET  /v1/projects/{projectId}/milestones — list with achievement + projected dates (api §6)
 * POST /v1/projects/{projectId}/milestones — create a milestone (plain insert)
 */
import { handler, json, readJson } from "@/lib/http";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { listMilestones, createMilestone, type CreateMilestoneInput } from "@/domain/milestones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { projectId } = await context.params;
  return json(await listMilestones(getDb(), ctx, projectId));
});

export const POST = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { projectId } = await context.params;
  const body = await readJson<CreateMilestoneInput>(req);
  return json(await createMilestone(getDb(), ctx, projectId, body), 201);
});
