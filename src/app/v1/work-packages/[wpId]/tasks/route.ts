/**
 * GET  /v1/work-packages/{wpId}/tasks  — list to-do lines (filter: status), each
 *                                         with derived `blocked`
 * POST /v1/work-packages/{wpId}/tasks  — create a task
 */
import { handler, json, readJson } from "@/lib/http";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { createTask, listTasks, type CreateTaskInput } from "@/domain/tasks";
import { createProposal } from "@/domain/replan/proposals";
import type { TaskStatus } from "@/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ wpId: string }> };

export const GET = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { wpId } = await context.params;
  const params = new URL(req.url).searchParams;
  const tasks = await listTasks(getDb(), ctx, wpId, {
    status: (params.get("status") as TaskStatus) ?? undefined,
  });
  return json(tasks);
});

export const POST = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { wpId } = await context.params;
  const body = await readJson<CreateTaskInput>(req);
  const now = new Date();
  const task = await createTask(getDb(), ctx, wpId, body, now, { autoPlace: true });

  // Adding work auto-creates a single (superseding) deadline-aware replan proposal —
  // the "lead the user to replan" path. Best-effort: a planner hiccup (e.g. invalid
  // dependency data) must never block task creation. Bulk/onboarding adds pass
  // ?defer_replan=true and issue one replan after the whole batch.
  const deferReplan = new URL(req.url).searchParams.get("defer_replan") === "true";
  if (!deferReplan) {
    try {
      await createProposal(getDb(), ctx, { trigger: "new_work_package", now });
    } catch {
      // Task is created; the user can still replan manually.
    }
  }
  return json(task, 201);
});
