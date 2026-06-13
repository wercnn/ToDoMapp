/**
 * Auth → workspace resolution (the tenancy boundary). Resolve the workspace from
 * the JWT: subject → app_user.auth_subject → workspace via workspace_member.
 * The workspace_id is injected server-side from here and NEVER accepted from the
 * client (api §1 Tenancy). Every domain query is scoped to `ctx.workspaceId`;
 * anything outside it is invisible → 404.
 */
import type { Executor } from "../db/transaction";
import { getDb } from "../db/kysely";
import { unauthenticated } from "../lib/errors";
import { verifyBearer, type AuthClaims } from "./verifier";

export interface AuthContext {
  userId: string;
  workspaceId: string;
  role: string;
  timezone: string;
  email: string;
  claims: AuthClaims;
}

/**
 * The minimal tenant identity domain logic needs to act "as" a user: who, in
 * which workspace, in what timezone. `AuthContext` satisfies it structurally, so
 * request handlers pass their full context unchanged. Background jobs — which
 * have no JWT — synthesise one of these straight from `app_user ⋈ workspace_member`
 * (the SAME resolution path as `resolveContext`), so a job can never fabricate a
 * workspace_id the membership table doesn't grant.
 */
export type WorkspaceContext = Pick<AuthContext, "userId" | "workspaceId" | "timezone">;

/**
 * Resolve the caller's user + workspace from a verified subject. Throws 401 if
 * the subject has no provisioned app_user (caller must hit /auth/bootstrap first)
 * or no workspace membership.
 */
export async function resolveContext(
  db: Executor,
  claims: AuthClaims,
): Promise<AuthContext> {
  const row = await db
    .selectFrom("app_user")
    .innerJoin("workspace_member", "workspace_member.user_id", "app_user.id")
    .select([
      "app_user.id as user_id",
      "app_user.email as email",
      "app_user.timezone as timezone",
      "workspace_member.workspace_id as workspace_id",
      "workspace_member.role as role",
    ])
    .where("app_user.auth_subject", "=", claims.subject)
    .executeTakeFirst();

  if (!row) {
    throw unauthenticated("User is not provisioned — call POST /v1/auth/bootstrap first");
  }

  return {
    userId: row.user_id,
    workspaceId: row.workspace_id,
    role: row.role,
    timezone: row.timezone,
    email: row.email,
    claims,
  };
}

/** Verify the bearer token and resolve the workspace context in one step. */
export async function requireAuth(req: Request, db = getDb()): Promise<AuthContext> {
  const claims = await verifyBearer(req);
  return resolveContext(db, claims);
}
