/**
 * PATCH  /v1/milestones/{milestoneId} — edit title/description/position (api §6).
 *   `achieved_at` is never writable — it's set once by the completion cascade.
 * DELETE /v1/milestones/{milestoneId} — remove WITHOUT deleting work: the composite
 *   FK ON DELETE SET NULL ungroups its work packages (data-model §4.2).
 */
import { handler, json, noContent, readJson } from "@/lib/http";
import { requireAuth } from "@/auth/context";
import { getDb } from "@/db/kysely";
import { updateMilestone, deleteMilestone, type UpdateMilestoneInput } from "@/domain/milestones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ milestoneId: string }> };

export const PATCH = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { milestoneId } = await context.params;
  const body = await readJson<UpdateMilestoneInput>(req);
  return json(await updateMilestone(getDb(), ctx, milestoneId, body));
});

export const DELETE = handler(async (req: Request, context: Ctx) => {
  const ctx = await requireAuth(req);
  const { milestoneId } = await context.params;
  await deleteMilestone(getDb(), ctx, milestoneId);
  return noContent();
});
