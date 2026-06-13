/**
 * POST /v1/auth/bootstrap — first-login provisioning (api §2). Verifies the JWT
 * (the user may not exist yet, so we use the token claims directly rather than
 * requireAuth), then idempotently provisions the user + personal workspace.
 */
import { handler, json, readJson } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { verifyBearer } from "@/auth/verifier";
import { getDb } from "@/db/kysely";
import { bootstrap } from "@/domain/bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  email?: string;
  display_name?: string | null;
  timezone?: string | null;
}

export const POST = handler(async (req: Request) => {
  const claims = await verifyBearer(req);
  const body = await readJson<Body>(req);

  const email = body.email ?? claims.email;
  if (!email || typeof email !== "string") {
    throw badRequest("email is required");
  }

  const result = await bootstrap(getDb(), {
    subject: claims.subject,
    input: { email, display_name: body.display_name, timezone: body.timezone },
  });

  return json({ user: result.user, workspace: result.workspace }, result.created ? 201 : 200);
});
