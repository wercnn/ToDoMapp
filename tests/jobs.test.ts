/**
 * Background-jobs tests (api §13). The jobs are pure-ish logic over DB state, so we
 * test them that way, with an injectable `now` (like flow.ts) so "it's midnight in
 * tz X" is deterministic.
 *
 * The cases that earn their keep:
 *  - slippage marks the right days + creates exactly one proposal, and is idempotent
 *    on re-run (no second slip, no duplicate proposal);
 *  - the detector mutates NO plan item and applies NO diff (invariant #5);
 *  - per-user timezone: a user whose local midnight has passed is processed, one
 *    whose hasn't is not (the boundary case, like flow's in_progress test);
 *  - cross-trigger supersession: slippage recovery replaces older pending proposals
 *    so slipped work is not stranded behind the roadmap;
 *  - notification selection respects preference flags + is deduped (catch-up-safe);
 *  - stale-token pruning deletes only devices past the threshold.
 *
 * Requires DIRECT_URL + applied schema (incl. the notification_dispatch migration).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import { createDb } from "@/db/kysely";
import type { Database } from "@/db/types";
import type { WorkspaceContext } from "@/auth/context";
import { detectSlippageForUser } from "@/domain/jobs/slippage";
import { sendMorningBrief } from "@/domain/jobs/morningBrief";
import { nudgeReplanNeedsReview } from "@/domain/jobs/nudges";
import { pruneStaleDevices } from "@/domain/jobs/prune";
import { getPreferences } from "@/domain/jobs/dispatch";
import { getMorningBrief } from "@/domain/morningBriefRead";
import { applyRecoveryProposal } from "@/domain/replan/proposals";
import type { Changes } from "@/domain/replan/types";
import type { NotificationPayload, Notifier, PushTarget } from "@/domain/jobs/notifier";
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
    throw new Error("DIRECT_URL is required to run the jobs tests (they hit Postgres).");
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

/** Mark a seeded day confirmed so it is eligible to slip. */
async function confirmDay(dayId: string, now: Date): Promise<void> {
  await db
    .updateTable("daily_plan_day")
    .set({ status: "confirmed", confirmed_at: now })
    .where("id", "=", dayId)
    .execute();
}

class SpyNotifier implements Notifier {
  sends: Array<{ target: PushTarget; payload: NotificationPayload }> = [];
  async send(target: PushTarget, payload: NotificationPayload): Promise<void> {
    this.sends.push({ target, payload });
  }
}

async function pendingProposals(workspaceId: string) {
  return db
    .selectFrom("replan_proposal")
    .select(["id", "trigger", "changes"])
    .where("workspace_id", "=", workspaceId)
    .where("status", "=", "pending")
    .execute();
}

async function planItems(workspaceId: string, taskId: string) {
  return db
    .selectFrom("daily_plan_item as i")
    .innerJoin("daily_plan_day as d", "d.id", "i.daily_plan_day_id")
    .select(["i.status", "i.origin", "d.plan_date as planDate"])
    .where("i.workspace_id", "=", workspaceId)
    .where("i.task_id", "=", taskId)
    .orderBy("d.plan_date")
    .execute();
}

describe("slippage detector", () => {
  it("marks past confirmed days slipped, creates one proposal, and is idempotent", async () => {
    const { ctx } = await provision({ timezone: "UTC" });
    const now = new Date("2026-06-14T12:00:00Z"); // local today = 2026-06-14 (UTC)
    const sc = await seedScenario(db, ctx, { planDate: "2026-06-10" });
    await confirmDay(sc.dayId, now);

    const first = await detectSlippageForUser(db, ctx, now);
    expect(first.slippedDayIds).toEqual([sc.dayId]);
    expect(first.proposalCreated).toBe(true);

    const day = await db
      .selectFrom("daily_plan_day")
      .select("status")
      .where("id", "=", sc.dayId)
      .executeTakeFirstOrThrow();
    expect(day.status).toBe("slipped");

    let pending = await pendingProposals(ctx.workspaceId);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.trigger).toBe("slippage");
    const changes = pending[0]!.changes as Changes;
    expect(changes.recovery).toMatchObject({
      local_date: "2026-06-14",
      slipped_dates: ["2026-06-10"],
      selected_today_task_ids: expect.arrayContaining([sc.t1Id, sc.t2Id]),
    });
    expect(changes.moves).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ task_id: sc.t1Id, from_date: "2026-06-10", to_date: "2026-06-14" }),
        expect.objectContaining({ task_id: sc.t2Id, from_date: "2026-06-10", to_date: "2026-06-14" }),
      ]),
    );

    // Re-run: already slipped → nothing new, no duplicate proposal.
    const second = await detectSlippageForUser(db, ctx, now);
    expect(second.slippedDayIds).toEqual([]);
    expect(second.proposalCreated).toBe(false);
    pending = await pendingProposals(ctx.workspaceId);
    expect(pending).toHaveLength(1);
  });

  it("never mutates a plan item or applies a diff (invariant #5)", async () => {
    const { ctx } = await provision({ timezone: "UTC" });
    const now = new Date("2026-06-14T12:00:00Z");
    const sc = await seedScenario(db, ctx, { planDate: "2026-06-10" });
    await confirmDay(sc.dayId, now);

    const before = await db
      .selectFrom("daily_plan_item")
      .select(["id", "status", "daily_plan_day_id", "task_id"])
      .where("workspace_id", "=", ctx.workspaceId)
      .orderBy("id")
      .execute();

    await detectSlippageForUser(db, ctx, now);

    const after = await db
      .selectFrom("daily_plan_item")
      .select(["id", "status", "daily_plan_day_id", "task_id"])
      .where("workspace_id", "=", ctx.workspaceId)
      .orderBy("id")
      .execute();

    // The detector only flips day status + creates a proposal; items are untouched.
    expect(after).toEqual(before);
    expect(after.every((i) => i.status === "planned")).toBe(true);
  });

  it("applies recovery choices: selected tasks land today and unselected tasks move future", async () => {
    const { ctx } = await provision({ timezone: "UTC" });
    const now = new Date("2026-06-14T12:00:00Z");
    const sc = await seedScenario(db, ctx, { planDate: "2026-06-10" });
    await confirmDay(sc.dayId, now);
    await detectSlippageForUser(db, ctx, now);
    const [proposal] = await pendingProposals(ctx.workspaceId);
    expect(proposal).toBeTruthy();

    const detail = await applyRecoveryProposal(db, ctx, proposal!.id, {
      todayTaskIds: [sc.t1Id],
      now,
    });
    expect(detail.proposal.status).toBe("edited_approved");
    expect(detail.changes.recovery).toMatchObject({
      selected_today_task_ids: [sc.t1Id],
      pushed_future_task_ids: [sc.t2Id],
    });

    expect(await planItems(ctx.workspaceId, sc.t1Id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ planDate: "2026-06-10", status: "deferred" }),
        expect.objectContaining({ planDate: "2026-06-14", status: "planned", origin: "replanned" }),
      ]),
    );
    expect(await planItems(ctx.workspaceId, sc.t2Id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ planDate: "2026-06-10", status: "deferred" }),
        expect.objectContaining({ planDate: "2026-06-15", status: "planned", origin: "replanned" }),
      ]),
    );
  });

  it("rejects recovery when a selected today task violates dependency order", async () => {
    const { ctx } = await provision({ timezone: "UTC" });
    const now = new Date("2026-06-14T12:00:00Z");
    const sc = await seedScenario(db, ctx, { planDate: "2026-06-10" });
    await db
      .insertInto("work_package_dependency")
      .values({ workspace_id: ctx.workspaceId, predecessor_wp_id: sc.wp1Id, successor_wp_id: sc.wp2Id })
      .execute();
    await confirmDay(sc.dayId, now);
    await detectSlippageForUser(db, ctx, now);
    const [proposal] = await pendingProposals(ctx.workspaceId);

    await expect(
      applyRecoveryProposal(db, ctx, proposal!.id, { todayTaskIds: [sc.t2Id], now }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("includes pending recovery detail in the morning brief", async () => {
    const { ctx } = await provision({ timezone: "UTC" });
    const now = new Date("2026-06-14T12:00:00Z");
    const sc = await seedScenario(db, ctx, { planDate: "2026-06-10" });
    await confirmDay(sc.dayId, now);
    await detectSlippageForUser(db, ctx, now);

    const brief = await getMorningBrief(db, ctx, now);
    expect(brief.pending_replan?.proposal.trigger).toBe("slippage");
    expect(brief.recovery).toMatchObject({
      local_date: "2026-06-14",
      slipped_task_ids: expect.arrayContaining([sc.t1Id, sc.t2Id]),
    });
  });

  it("processes a user past local midnight but not one whose local day hasn't turned", async () => {
    // Same instant; A (UTC) has rolled into 06-15, B (UTC-12) is still on 06-14.
    const now = new Date("2026-06-15T06:00:00Z");
    const a = await provision({ timezone: "UTC" });
    const b = await provision({ timezone: "Etc/GMT+12" });
    const scA = await seedScenario(db, a.ctx, { planDate: "2026-06-14" });
    const scB = await seedScenario(db, b.ctx, { planDate: "2026-06-14" });
    await confirmDay(scA.dayId, now);
    await confirmDay(scB.dayId, now);

    const ra = await detectSlippageForUser(db, a.ctx, now);
    const rb = await detectSlippageForUser(db, b.ctx, now);

    expect(ra.slippedDayIds).toEqual([scA.dayId]);
    expect(rb.slippedDayIds).toEqual([]);

    const dayB = await db
      .selectFrom("daily_plan_day")
      .select("status")
      .where("id", "=", scB.dayId)
      .executeTakeFirstOrThrow();
    expect(dayB.status).toBe("confirmed"); // B's day has NOT slipped yet
  });

  it("supersedes a pending user_request proposal so slipped work gets recovery", async () => {
    const { ctx } = await provision({ timezone: "UTC" });
    const now = new Date("2026-06-14T12:00:00Z");
    const sc = await seedScenario(db, ctx, { planDate: "2026-06-10" });
    await confirmDay(sc.dayId, now);

    // The user already has a pending proposal, but slipped work still needs a recovery proposal.
    const userProposal = await db
      .insertInto("replan_proposal")
      .values({
        workspace_id: ctx.workspaceId,
        trigger: "user_request",
        status: "pending",
        summary: "user-initiated",
        changes: JSON.stringify({ moves: [], milestone_impacts: [], time_fixed_conflicts: [] }),
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    const res = await detectSlippageForUser(db, ctx, now);
    expect(res.slippedDayIds).toEqual([sc.dayId]);
    expect(res.proposalCreated).toBe(true);

    const pending = await pendingProposals(ctx.workspaceId);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.trigger).toBe("slippage");
    expect((pending[0]!.changes as Changes).recovery?.slipped_task_ids).toEqual(
      expect.arrayContaining([sc.t1Id, sc.t2Id]),
    );
    const expired = await db
      .selectFrom("replan_proposal")
      .select("status")
      .where("id", "=", userProposal.id)
      .executeTakeFirstOrThrow();
    expect(expired.status).toBe("expired");
  });
});

describe("notification selection", () => {
  it("sends the morning brief once it's due, respects the flag, and dedupes", async () => {
    const { ctx } = await provision({ timezone: "UTC" });
    await db
      .insertInto("device")
      .values({ user_id: ctx.userId, push_token: `tok-${ctx.userId}`, last_seen_at: new Date() })
      .execute();
    const now = new Date("2026-06-14T08:00:00Z"); // local 08:00 ≥ default 07:00

    const pref = await getPreferences(db, ctx.userId);
    const notifier = new SpyNotifier();

    const sent = await sendMorningBrief(db, ctx, pref!, now, notifier);
    expect(sent).toBe(true);
    expect(notifier.sends).toHaveLength(1);
    expect(notifier.sends[0]!.payload.kind).toBe("morning_brief");

    // Same local day → deduped via the ledger, even if the tick fires again.
    const again = await sendMorningBrief(db, ctx, pref!, now, notifier);
    expect(again).toBe(false);
    expect(notifier.sends).toHaveLength(1);
  });

  it("does not send the morning brief when the flag is off", async () => {
    const { ctx } = await provision({ timezone: "UTC" });
    await db
      .insertInto("device")
      .values({ user_id: ctx.userId, push_token: `tok-${ctx.userId}`, last_seen_at: new Date() })
      .execute();
    await db
      .updateTable("notification_preference")
      .set({ morning_brief_enabled: false })
      .where("user_id", "=", ctx.userId)
      .execute();
    const now = new Date("2026-06-14T08:00:00Z");

    const pref = await getPreferences(db, ctx.userId);
    const notifier = new SpyNotifier();
    const sent = await sendMorningBrief(db, ctx, pref!, now, notifier);
    expect(sent).toBe(false);
    expect(notifier.sends).toHaveLength(0);
  });

  it("fires the replan nudge once per proposal, gated by its flag", async () => {
    const { ctx } = await provision({ timezone: "UTC" });
    await db
      .insertInto("device")
      .values({ user_id: ctx.userId, push_token: `tok-${ctx.userId}`, last_seen_at: new Date() })
      .execute();
    await db
      .insertInto("replan_proposal")
      .values({
        workspace_id: ctx.workspaceId,
        trigger: "slippage",
        status: "pending",
        summary: "2 tasks need rescheduling",
        changes: JSON.stringify({ moves: [], milestone_impacts: [], time_fixed_conflicts: [] }),
      })
      .execute();

    // Flag off → not selected.
    await db
      .updateTable("notification_preference")
      .set({ replan_nudges_enabled: false })
      .where("user_id", "=", ctx.userId)
      .execute();
    let pref = await getPreferences(db, ctx.userId);
    const notifier = new SpyNotifier();
    expect(await nudgeReplanNeedsReview(db, ctx as WorkspaceContext, pref!, notifier)).toBe(false);
    expect(notifier.sends).toHaveLength(0);

    // Flag on → fires once, then deduped on the same proposal.
    await db
      .updateTable("notification_preference")
      .set({ replan_nudges_enabled: true })
      .where("user_id", "=", ctx.userId)
      .execute();
    pref = await getPreferences(db, ctx.userId);
    expect(await nudgeReplanNeedsReview(db, ctx as WorkspaceContext, pref!, notifier)).toBe(true);
    expect(await nudgeReplanNeedsReview(db, ctx as WorkspaceContext, pref!, notifier)).toBe(false);
    expect(notifier.sends).toHaveLength(1);
    expect(notifier.sends[0]!.payload.kind).toBe("replan_needs_review");
  });
});

describe("stale-token pruning", () => {
  it("deletes only devices unseen past the threshold", async () => {
    const { ctx } = await provision({ timezone: "UTC" });
    const now = new Date("2026-06-14T12:00:00Z");
    const old = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000); // 40d ago
    const fresh = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000); // 1d ago
    await db
      .insertInto("device")
      .values([
        { user_id: ctx.userId, push_token: `old-${ctx.userId}`, last_seen_at: old },
        { user_id: ctx.userId, push_token: `fresh-${ctx.userId}`, last_seen_at: fresh },
      ])
      .execute();

    const deleted = await pruneStaleDevices(db, now, 30);
    expect(deleted).toBe(1);

    const remaining = await db
      .selectFrom("device")
      .select("push_token")
      .where("user_id", "=", ctx.userId)
      .execute();
    expect(remaining.map((r) => r.push_token)).toEqual([`fresh-${ctx.userId}`]);
  });
});
