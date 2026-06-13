/**
 * Seed script — populates a known test workspace (goal → project → milestone →
 * work packages → tasks, plus a planned day for "today") so the completion
 * cascade can be wiped and re-run quickly.
 *
 *   npm run seed            # (re)create the seed workspace and scenario
 *   npm run seed -- --reset # delete the seed workspace only, then exit
 *
 * Uses the DIRECT connection (port 5432). Idempotent: it removes any existing
 * seed workspace first so re-running is clean.
 */
import { createDb } from "../src/db/kysely";
import { localDate } from "../src/lib/dates";
import {
  provisionWorkspace,
  seedScenario,
  teardownWorkspace,
} from "../src/testing/fixtures";
import { loadEnv } from "./env";

const SEED_SUBJECT = "seed-user-fixed-subject";
const SEED_EMAIL = "seed@example.test";
const SEED_TZ = "UTC";

async function main() {
  const reset = process.argv.includes("--reset");
  const env = loadEnv();
  const connectionString = env.DIRECT_URL;
  if (!connectionString) {
    throw new Error("DIRECT_URL is not set. See .env.example.");
  }
  const db = createDb(connectionString);

  try {
    // Remove any prior seed workspace so this is deterministic.
    const existing = await db
      .selectFrom("app_user")
      .innerJoin("workspace_member", "workspace_member.user_id", "app_user.id")
      .select(["app_user.id as user_id", "workspace_member.workspace_id as workspace_id"])
      .where("app_user.auth_subject", "=", SEED_SUBJECT)
      .executeTakeFirst();
    if (existing) {
      await teardownWorkspace(db, {
        userId: existing.user_id,
        workspaceId: existing.workspace_id,
      });
      console.log("Removed existing seed workspace.");
    }

    if (reset) {
      console.log("Reset complete.");
      return;
    }

    const { ctx, userId, workspaceId } = await provisionWorkspace(db, {
      subject: SEED_SUBJECT,
      email: SEED_EMAIL,
      timezone: SEED_TZ,
    });
    const planDate = localDate(SEED_TZ);
    const scenario = await seedScenario(db, ctx, { planDate });

    console.log("Seeded workspace:");
    console.log(JSON.stringify({ userId, workspaceId, planDate, ...scenario }, null, 2));
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
