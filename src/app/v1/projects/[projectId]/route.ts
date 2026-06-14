/**
 * GET    /v1/projects/{projectId}  — read one project (Query: include=progress) (api §5)
 * PATCH  /v1/projects/{projectId}  — edit incl. capacity, target end date, status
 * DELETE /v1/projects/{projectId}  — delete project subtree (FK cascade)
 */
import { handler, json, noContent, readJson } from "@/lib/http";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import {
  getProject,
  updateProject,
  deleteProject,
  type UpdateProjectInput,
} from "@/domain/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { projectId } = await context.params;
  const includeProgress = new URL(req.url).searchParams.get("include") === "progress";
  return json(await getProject(getDb(), ctx, projectId, { includeProgress }));
});

export const PATCH = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { projectId } = await context.params;
  const body = await readJson<UpdateProjectInput>(req);
  return json(await updateProject(getDb(), ctx, projectId, body));
});

export const DELETE = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { projectId } = await context.params;
  await deleteProject(getDb(), ctx, projectId);
  return noContent();
});
