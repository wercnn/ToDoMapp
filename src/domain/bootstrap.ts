/**
 * First-login provisioning (api-endpoints.md §2 /auth/bootstrap). Idempotent: if
 * the auth_subject already has an app_user, returns the existing records.
 * Otherwise creates, in one transaction (invariant #7): app_user, a personal
 * workspace, an `owner` workspace_member (invariant #2: exactly one member in v1),
 * zeroed user_stats, and default notification_preference.
 */
import type { Kysely } from "kysely";
import type { AppUser, Database, Workspace } from "../db/types";
import { withTransaction } from "../db/transaction";

export interface BootstrapInput {
  email: string;
  display_name?: string | null;
  timezone?: string | null;
}

export interface BootstrapResult {
  user: AppUser;
  workspace: Workspace;
  created: boolean;
}

export async function bootstrap(
  db: Kysely<Database>,
  args: { subject: string; input: BootstrapInput },
): Promise<BootstrapResult> {
  const { subject, input } = args;

  return withTransaction(db, async (trx) => {
    const existing = await trx
      .selectFrom("app_user")
      .selectAll()
      .where("auth_subject", "=", subject)
      .executeTakeFirst();

    if (existing) {
      const workspace = await trx
        .selectFrom("workspace")
        .innerJoin("workspace_member", "workspace_member.workspace_id", "workspace.id")
        .selectAll("workspace")
        .where("workspace_member.user_id", "=", existing.id)
        .executeTakeFirstOrThrow();
      return { user: existing, workspace, created: false };
    }

    const displayName = input.display_name ?? null;
    const user = await trx
      .insertInto("app_user")
      .values({
        auth_subject: subject,
        email: input.email,
        display_name: displayName,
        timezone: input.timezone ?? "UTC",
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const workspace = await trx
      .insertInto("workspace")
      .values({ name: displayName ?? input.email })
      .returningAll()
      .executeTakeFirstOrThrow();

    await trx
      .insertInto("workspace_member")
      .values({ workspace_id: workspace.id, user_id: user.id, role: "owner" })
      .execute();

    await trx
      .insertInto("user_stats")
      .values({ user_id: user.id, workspace_id: workspace.id })
      .execute();

    await trx
      .insertInto("notification_preference")
      .values({ user_id: user.id })
      .execute();

    return { user, workspace, created: true };
  });
}
