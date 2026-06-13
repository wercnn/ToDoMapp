/**
 * Replan APPLY — the landmine (api §11, invariants #4 and #5). Mutates
 * `daily_plan_*` to enact an approved diff. ALWAYS called inside a transaction the
 * caller already opened (proposals.ts), so the status-claim UPDATE and every plan
 * mutation commit or roll back together.
 *
 * Guards, enforced BEFORE any mutation:
 *  - #4 time-fixed: any time-fixed task appearing in `moves` requires an explicit
 *    `time_fixed_resolutions` choice, else 422 and zero writes.
 *  - locked days are untouchable in BOTH directions — a move whose from_date OR
 *    to_date (or a renegotiated date) is a locked day is rejected (422).
 *
 * Per-move semantics:
 *  - old item (from_date) → status='deferred' (history preserved, NO penalty events,
 *    Principle 3). Done BEFORE the new insert so the partial unique
 *    `daily_plan_item_one_planned_per_task` never trips.
 *  - new item → fresh row, origin='replanned', status='planned', on the to_date day
 *    (created 'confirmed' if absent — approval IS the authorization, matching
 *    confirmDay's shape).
 *  - time-fixed resolutions: `prioritize` keeps it put (skip the move); `descope`
 *    defers the old item with NO successor (its authoritative trace is the stored
 *    applied_changes); `renegotiate` updates task.fixed_date and honors the move.
 */
import type { Transaction } from "kysely";
import type { Database, DailyPlanDay, DailyPlanItem } from "../../db/types";
import type { AuthContext } from "../../auth/context";
import { unprocessable } from "../../lib/errors";
import { createConfirmedDay } from "../planDays";
import type { Changes, TimeFixedResolution } from "./types";

export interface ApplyResult {
  days: DailyPlanDay[];
  items: DailyPlanItem[];
}

export async function applyChanges(
  trx: Transaction<Database>,
  ctx: AuthContext,
  changes: Changes,
  now: Date,
): Promise<ApplyResult> {
  const ws = ctx.workspaceId;
  const moves = changes.moves ?? [];
  const resolutions = new Map<string, TimeFixedResolution>(
    (changes.time_fixed_resolutions ?? []).map((r) => [r.task_id, r]),
  );

  // --- Guard #4: time-fixed tasks in `moves` need an explicit choice. ---
  const moveTaskIds = [...new Set(moves.map((m) => m.task_id))];
  const tfRows = moveTaskIds.length
    ? await trx
        .selectFrom("task")
        .select(["id", "is_time_fixed", "fixed_date"])
        .where("workspace_id", "=", ws)
        .where("id", "in", moveTaskIds)
        .where("is_time_fixed", "=", true)
        .execute()
    : [];
  const timeFixed = new Set(tfRows.map((t) => t.id));
  for (const m of moves) {
    if (timeFixed.has(m.task_id) && !resolutions.has(m.task_id)) {
      throw unprocessable(
        `Diff moves time-fixed task ${m.task_id} without an explicit choice ` +
          `(prioritize / descope / renegotiate) — refusing to auto-move it (invariant #4).`,
      );
    }
  }

  // --- Locked-day guard: untouchable in BOTH directions. ---
  const touchedDates = new Set<string>();
  for (const m of moves) {
    if (m.from_date) touchedDates.add(m.from_date);
    if (m.to_date) touchedDates.add(m.to_date);
  }
  for (const r of resolutions.values()) {
    if (r.new_fixed_date) touchedDates.add(r.new_fixed_date);
  }
  if (touchedDates.size > 0) {
    const locked = await trx
      .selectFrom("daily_plan_day")
      .select("plan_date")
      .where("workspace_id", "=", ws)
      .where("plan_date", "in", [...touchedDates])
      .where("is_locked", "=", true)
      .execute();
    if (locked.length > 0) {
      throw unprocessable(
        `Diff touches locked day(s) ${locked.map((d) => d.plan_date).join(", ")} — locked days are untouchable.`,
      );
    }
  }

  // --- Apply each move (defer-before-insert). ---
  const days: DailyPlanDay[] = [];
  const dayCache = new Map<string, DailyPlanDay>();
  const items: DailyPlanItem[] = [];

  const ensureDay = async (planDate: string): Promise<DailyPlanDay> => {
    const cached = dayCache.get(planDate);
    if (cached) return cached;
    const existing = await trx
      .selectFrom("daily_plan_day")
      .selectAll()
      .where("workspace_id", "=", ws)
      .where("plan_date", "=", planDate)
      .executeTakeFirst();
    const day = existing ?? (await createConfirmedDay(trx, ws, planDate, now));
    dayCache.set(planDate, day);
    days.push(day);
    return day;
  };

  for (const m of moves) {
    const res = resolutions.get(m.task_id);
    const isTimeFixed = timeFixed.has(m.task_id);

    // prioritize: keep the commitment exactly where it is — no defer, no insert.
    if (isTimeFixed && res?.choice === "prioritize") continue;

    // Defer the old planned item on its original day.
    if (m.from_date) {
      await trx
        .updateTable("daily_plan_item")
        .set({ status: "deferred", updated_at: now })
        .where("workspace_id", "=", ws)
        .where("task_id", "=", m.task_id)
        .where("status", "=", "planned")
        .where("daily_plan_day_id", "in", (qb) =>
          qb
            .selectFrom("daily_plan_day")
            .select("id")
            .where("workspace_id", "=", ws)
            .where("plan_date", "=", m.from_date as string),
        )
        .execute();
    }

    // descope: dropped from the plan, no successor item.
    if (isTimeFixed && res?.choice === "descope") continue;

    // renegotiate: move the commitment to the user-chosen date and update the task.
    let toDate = m.to_date;
    if (isTimeFixed && res?.choice === "renegotiate") {
      if (!res.new_fixed_date) {
        throw unprocessable(`renegotiate of task ${m.task_id} requires new_fixed_date.`);
      }
      await trx
        .updateTable("task")
        .set({ fixed_date: res.new_fixed_date, updated_at: now })
        .where("workspace_id", "=", ws)
        .where("id", "=", m.task_id)
        .execute();
      toDate = res.new_fixed_date;
    }

    if (!toDate) continue; // pure descheduling (to_date null) — just deferred.

    const day = await ensureDay(toDate);
    const maxPos = await trx
      .selectFrom("daily_plan_item")
      .select((eb) => eb.fn.max("position").as("m"))
      .where("daily_plan_day_id", "=", day.id)
      .executeTakeFirst();
    const item = await trx
      .insertInto("daily_plan_item")
      .values({
        workspace_id: ws,
        daily_plan_day_id: day.id,
        item_type: "task",
        task_id: m.task_id,
        status: "planned",
        origin: "replanned",
        position: Number(maxPos?.m ?? -1) + 1,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    items.push(item);
  }

  return { days, items };
}
