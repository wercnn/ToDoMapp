/**
 * Phase 7 — Companion & motivation reads (api §2, §3, §10, §12).
 *
 * The cases that earn their keep:
 *  - device upsert by unique push_token: re-register refreshes (no dup), and a
 *    re-register by a DIFFERENT user REASSIGNS the row (last-login-wins); delete is
 *    caller-scoped (other user's device → 404).
 *  - notification prefs: full replace round-trips.
 *  - engagement idempotency: a double call the same local day → exactly ONE
 *    engagement_day row (reuses the shared recordEngagement, not a reimplementation).
 *  - morning-brief: returns points AND streak AND the pending proposal, records eng
 *    once, surfaces the nearest milestone — and an empty morning returns today:null
 *    (never 404).
 *  - point-events: from/to bounds are resolved in the USER's timezone (a UTC-12 user
 *    proves the boundary is local end-of-day, not a UTC instant), event_type filters.
 *
 * Requires DIRECT_URL + applied schema.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import { createDb } from "@/db/kysely";
import type { Database } from "@/db/types";
import { getMe, updateMe, getStats, recordEngagementAction } from "@/domain/me";
import { listDevices, registerDevice, deleteDevice } from "@/domain/devices";
import { getPrefs, replacePrefs } from "@/domain/notificationPrefs";
import { listPointEvents, listPointRules } from "@/domain/points";
import { getMorningBrief } from "@/domain/morningBriefRead";
import { createProposalInTx } from "@/domain/replan/proposals";
import { withTransaction } from "@/db/transaction";
import { localDate } from "@/lib/dates";
import {
  provisionWorkspace,
  seedScenario,
  teardownWorkspace,
  type ProvisionedWorkspace,
} from "@/testing/fixtures";
import { loadEnv } from "../scripts/env";

let db: Kysely<Database>;
const provisioned: ProvisionedWorkspace[] = [];

beforeAll(() => {
  const env = loadEnv();
  if (!env.DIRECT_URL) {
    throw new Error("DIRECT_URL is required to run the companion tests (they hit Postgres).");
  }
  db = createDb(env.DIRECT_URL);
});

afterAll(async () => {
  if (db) await db.destroy();
});

afterEach(async () => {
  for (const p of provisioned.splice(0)) {
    await teardownWorkspace(db, { workspaceId: p.workspaceId, userId: p.userId });
  }
});

async function provision(opts: { timezone?: string } = {}): Promise<ProvisionedWorkspace> {
  const p = await provisionWorkspace(db, opts);
  provisioned.push(p);
  return p;
}

describe("identity & profile", () => {
  it("reads profile + workspace and updates display_name/timezone", async () => {
    const p = await provision();
    const me = await getMe(db, p.ctx);
    expect(me.user.id).toBe(p.userId);
    expect(me.workspace.id).toBe(p.workspaceId);
    expect(me.role).toBe("owner");

    const updated = await updateMe(db, p.ctx, { display_name: "Renamed", timezone: "Europe/Berlin" });
    expect(updated.display_name).toBe("Renamed");
    expect(updated.timezone).toBe("Europe/Berlin");
  });

  it("seeds a zeroed stats row at bootstrap", async () => {
    const p = await provision();
    const stats = await getStats(db, p.ctx);
    expect(stats.total_points).toBe(0);
    expect(stats.current_streak).toBe(0);
  });
});

describe("devices", () => {
  it("upserts by push_token: re-register refreshes, never duplicates", async () => {
    const p = await provision();
    const t0 = new Date("2026-06-14T08:00:00Z");
    const t1 = new Date("2026-06-14T09:00:00Z");

    const first = await registerDevice(db, p.ctx, { platform: "ios", push_token: "tok-A" }, t0);
    expect(first.push_token).toBe("tok-A");

    const second = await registerDevice(db, p.ctx, { platform: "ios", push_token: "tok-A" }, t1);
    expect(second.id).toBe(first.id); // same row
    expect(new Date(second.last_seen_at!).getTime()).toBe(t1.getTime()); // refreshed

    const list = await listDevices(db, p.ctx);
    expect(list).toHaveLength(1);
  });

  it("reassigns the row to whoever registers the token last (last-login-wins)", async () => {
    const a = await provision();
    const b = await provision();

    await registerDevice(db, a.ctx, { platform: "ios", push_token: "shared-tok" });
    expect(await listDevices(db, a.ctx)).toHaveLength(1);

    await registerDevice(db, b.ctx, { platform: "ios", push_token: "shared-tok" });
    expect(await listDevices(db, a.ctx)).toHaveLength(0); // moved away from A
    expect(await listDevices(db, b.ctx)).toHaveLength(1); // now B's
  });

  it("deletes only the caller's device; another user's device → 404", async () => {
    const a = await provision();
    const b = await provision();
    const dev = await registerDevice(db, a.ctx, { platform: "ios", push_token: "del-tok" });

    await expect(deleteDevice(db, b.ctx, dev.id)).rejects.toMatchObject({ status: 404 });
    expect(await listDevices(db, a.ctx)).toHaveLength(1); // untouched

    await deleteDevice(db, a.ctx, dev.id);
    expect(await listDevices(db, a.ctx)).toHaveLength(0);
  });
});

describe("notification preferences", () => {
  it("full-replaces the settings row", async () => {
    const p = await provision();
    const defaults = await getPrefs(db, p.ctx);
    expect(defaults.morning_brief_enabled).toBe(true);

    await replacePrefs(db, p.ctx, {
      morning_brief_enabled: false,
      morning_brief_time: "06:30",
      milestone_nudges_enabled: false,
      replan_nudges_enabled: false,
      streak_nudges_enabled: false,
    });
    const after = await getPrefs(db, p.ctx);
    expect(after.morning_brief_enabled).toBe(false);
    expect(after.morning_brief_time.startsWith("06:30")).toBe(true);
    expect(after.streak_nudges_enabled).toBe(false);
  });
});

describe("engagement", () => {
  it("is idempotent: a double call the same local day → one row", async () => {
    const p = await provision();
    const now = new Date("2026-06-14T10:00:00Z");
    const today = localDate(p.ctx.timezone, now);

    const r1 = await recordEngagementAction(db, p.ctx, now);
    const r2 = await recordEngagementAction(db, p.ctx, new Date("2026-06-14T18:00:00Z"));
    expect(r1.activity_date).toBe(today);
    expect(r2.activity_date).toBe(today);
    expect(r2.current_streak).toBe(1);

    const rows = await db
      .selectFrom("engagement_day")
      .selectAll()
      .where("user_id", "=", p.userId)
      .where("activity_date", "=", today)
      .execute();
    expect(rows).toHaveLength(1);
  });
});

describe("morning-brief", () => {
  it("returns today's goals, points AND streak, the pending proposal, and next milestone", async () => {
    const p = await provision();
    const now = new Date("2026-06-14T07:00:00Z");
    const today = localDate(p.ctx.timezone, now);
    const scenario = await seedScenario(db, p.ctx, { planDate: today });

    // A pending recovery proposal to surface in the headline.
    const proposal = await withTransaction(db, (trx) =>
      createProposalInTx(trx, p.ctx, {
        trigger: "user_request",
        summary: "2 tasks from yesterday are pending",
        changes: { moves: [], milestone_impacts: [], time_fixed_conflicts: [] },
        now,
      }),
    );

    const brief = await getMorningBrief(db, p.ctx, now);

    expect(brief.today).not.toBeNull();
    expect(brief.today!.items).toHaveLength(2);
    // points AND streak — the brief surfaces both (api §4.6).
    expect(brief.stats.total_points).toBe(0);
    expect(brief.stats.current_streak).toBe(1); // opening the brief recorded eng
    expect(brief.position.current_streak).toBe(1);
    expect(brief.pending_proposal).toEqual({ id: proposal.id, summary: proposal.summary });
    expect(brief.next_milestone?.id).toBe(scenario.milestoneId);
    expect(typeof brief.next_milestone?.days_away).toBe("number");

    // Records engagement exactly once (idempotent on re-open).
    await getMorningBrief(db, p.ctx, new Date("2026-06-14T11:00:00Z"));
    const eng = await db
      .selectFrom("engagement_day")
      .selectAll()
      .where("user_id", "=", p.userId)
      .where("activity_date", "=", today)
      .execute();
    expect(eng).toHaveLength(1);
  });

  it("an empty morning returns today:null, never 404", async () => {
    const p = await provision();
    const brief = await getMorningBrief(db, p.ctx, new Date("2026-06-14T07:00:00Z"));
    expect(brief.today).toBeNull();
    expect(brief.pending_proposal).toBeNull();
    expect(brief.next_milestone).toBeNull();
    expect(brief.stats.current_streak).toBe(1); // eng still recorded
  });
});

describe("point-events & rules", () => {
  it("reads the seed rules", async () => {
    const p = await provision();
    const rules = await listPointRules(db, p.ctx);
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.every((r) => typeof r.points === "number")).toBe(true);
  });

  it("filters by event_type and by local-day from/to bounds", async () => {
    const p = await provision();
    const ws = p.workspaceId;
    // task_completed rows with NULL source (allowed: family check + partial unique
    // index only constrain non-null sources) on three distinct UTC days.
    await db
      .insertInto("point_event")
      .values([
        { workspace_id: ws, user_id: p.userId, event_type: "task_completed", points: 10, occurred_at: new Date("2026-06-10T12:00:00Z") },
        { workspace_id: ws, user_id: p.userId, event_type: "task_completed", points: 10, occurred_at: new Date("2026-06-12T12:00:00Z") },
        { workspace_id: ws, user_id: p.userId, event_type: "daily_goal_completed", points: 25, occurred_at: new Date("2026-06-14T12:00:00Z") },
      ])
      .execute();

    expect(await listPointEvents(db, p.ctx, {})).toHaveLength(3);
    expect(await listPointEvents(db, p.ctx, { eventType: "daily_goal_completed" })).toHaveLength(1);
    // from is inclusive of the local day it names.
    expect(await listPointEvents(db, p.ctx, { from: "2026-06-12" })).toHaveLength(2);
    // to runs through end of the named local day.
    expect(await listPointEvents(db, p.ctx, { to: "2026-06-12" })).toHaveLength(2);
    expect(await listPointEvents(db, p.ctx, { from: "2026-06-12", to: "2026-06-12" })).toHaveLength(1);
  });

  it("resolves from/to bounds in the user's timezone (UTC-12), not UTC", async () => {
    const p = await provision({ timezone: "Etc/GMT+12" }); // UTC-12
    const ws = p.workspaceId;
    // 2026-06-14T05:00Z is 2026-06-13 17:00 LOCAL in UTC-12.
    await db
      .insertInto("point_event")
      .values({ workspace_id: ws, user_id: p.userId, event_type: "task_completed", points: 10, occurred_at: new Date("2026-06-14T05:00:00Z") })
      .execute();

    // Local-day classification: it belongs to 2026-06-13, not 2026-06-14.
    expect(await listPointEvents(db, p.ctx, { to: "2026-06-13" })).toHaveLength(1);
    expect(await listPointEvents(db, p.ctx, { from: "2026-06-14" })).toHaveLength(0);
  });
});
