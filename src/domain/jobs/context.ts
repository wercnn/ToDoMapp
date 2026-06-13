/**
 * The candidate-user scan that drives every per-user background job (§13).
 *
 * Tenancy note (the airtight bit): a job acts "as" a user but has no JWT. The ONLY
 * way it learns a user's workspace is this `app_user ⋈ workspace_member` join — the
 * SAME resolution `auth/context.ts#resolveContext` uses for a request. `workspaceId`
 * is therefore never client- or caller-supplied; it can only be a workspace the
 * membership table actually grants. There is no other path to a `WorkspaceContext`.
 */
import type { Kysely } from "kysely";
import type { Database } from "../../db/types";
import type { WorkspaceContext } from "../../auth/context";

/** Every provisioned user with their workspace + timezone, as job-scoped contexts. */
export async function resolveJobUsers(db: Kysely<Database>): Promise<WorkspaceContext[]> {
  return db
    .selectFrom("app_user")
    .innerJoin("workspace_member", "workspace_member.user_id", "app_user.id")
    .select([
      "app_user.id as userId",
      "app_user.timezone as timezone",
      "workspace_member.workspace_id as workspaceId",
    ])
    .execute();
}
