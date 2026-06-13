/**
 * GET  /v1/goals/{goalId}/projects  — list a goal's projects (filter: status)
 * POST /v1/goals/{goalId}/projects  — create a project (validates capacity)
 */
import { handler, json, readJson } from "@/lib/http";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { createProject, listProjects, type CreateProjectInput } from "@/domain/projects";
import type { ProjectStatus } from "@/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ goalId: string }> };

export const GET = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { goalId } = await context.params;
  const params = new URL(req.url).searchParams;
  const projects = await listProjects(getDb(), ctx, goalId, {
    status: (params.get("status") as ProjectStatus) ?? undefined,
  });
  return json(projects);
});

export const POST = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { goalId } = await context.params;
  const body = await readJson<CreateProjectInput>(req);
  const project = await createProject(getDb(), ctx, goalId, body);
  return json(project, 201);
});
