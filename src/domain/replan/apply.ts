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
 *  - any DEFERRED tombstone the task already has on the to_date day is dropped first,
 *    so re-planning a task back onto a day it once left can't trip the full
 *    `UNIQUE (daily_plan_day_id, task_id)` (one row per task per day, any status).
 *  - new item → fresh row, origin='replanned', status='planned', on the to_date day
 *    (created 'confirmed' if absent — approval IS the authorization, matching
 *    confirmDay's shape). Same-day moves are applied in task-position order so the
 *    day reads in work-package order, not random task id order.
 *  - time-fixed resolutions: `prioritize` keeps it put (skip the move); `descope`
 *    defers the old item with NO successor (its authoritative trace is the stored
 *    applied_changes); `renegotiate` updates task.fixed_date and honors the move.
 */
import type { Transaction } from "kysely";
import type { Database, DailyPlanDay, DailyPlanItem } from "../../db/types";
import type { AuthContext } from "../../auth/context";
import { unprocessable } from "../../lib/errors";
import { createConfirmedDay } from "../planDays";
import type { Changes, SplitReport, TimeFixedResolution } from "./types";

export interface ApplyResult {
  days: DailyPlanDay[];
  items: DailyPlanItem[];
  split_task_id_map: Record<string, string>;
}

function splitVirtualIds(splitReports: SplitReport[]): Set<string> {
  return new Set(splitReports.flatMap((r) => r.parts.map((p) => p.task_id)));
}

function validateSplitApproval(splitReports: SplitReport[], moves: Changes["moves"]): void {
  const virtualIds = splitVirtualIds(splitReports);
  const moveByTask = new Map(moves.map((m) => [m.task_id, m]));
  for (const report of splitReports) {
    const missing = report.parts.filter((p) => !moveByTask.get(p.task_id)?.to_date);
    if (missing.length > 0) {
      throw unprocessable(
        `Split approval for task ${report.original_task_id} must include every split part.`,
      );
    }
  }
  for (const move of moves) {
    if (move.task_id.includes("__part_") && !virtualIds.has(move.task_id)) {
      throw unprocessable(`Unknown virtual split task ${move.task_id}.`);
    }
  }
}

async function materializeSplits(
  trx: Transaction<Database>,
  ctx: AuthContext,
  splitReports: SplitReport[],
  now: Date,
): Promise<Record<string, string>> {
  if (splitReports.length === 0) return {};

  const originalIds = splitReports.map((r) => r.original_task_id);
  const originals = await trx
    .selectFrom("task")
    .selectAll()
    .where("workspace_id", "=", ctx.workspaceId)
    .where("id", "in", originalIds)
    .execute();
  const originalById = new Map(originals.map((t) => [t.id, t]));
  const splitTaskIdMap: Record<string, string> = {};
  const firstPartByOriginal = new Map<string, string>();
  const lastPartByOriginal = new Map<string, string>();

  for (const report of splitReports) {
    const original = originalById.get(report.original_task_id);
    if (!original) throw unprocessable(`Original split task ${report.original_task_id} was not found.`);
    if (original.replaced_at) {
      throw unprocessable(`Original split task ${report.original_task_id} has already been replaced.`);
    }

    for (let i = 0; i < report.parts.length; i++) {
      const part = report.parts[i]!;
      const idx = i + 1;
      const inserted = await trx
        .insertInto("task")
        .values({
          workspace_id: ctx.workspaceId,
          work_package_id: original.work_package_id,
          title: part.title,
          notes: original.notes,
          estimate_hours: part.hours,
          difficulty: null,
          is_time_fixed: false,
          fixed_date: null,
          status: "todo",
          original_task_id: original.id,
          split_index: idx,
          split_count: report.parts.length,
          is_split_part: true,
          position: original.position * 1000 + idx,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      splitTaskIdMap[part.task_id] = inserted.id;
      if (idx === 1) firstPartByOriginal.set(original.id, inserted.id);
      if (idx === report.parts.length) lastPartByOriginal.set(original.id, inserted.id);
    }
  }

  const existingEdges = await trx
    .selectFrom("task_dependency")
    .select(["predecessor_task_id", "successor_task_id"])
    .where("workspace_id", "=", ctx.workspaceId)
    .where((eb) =>
      eb.or([
        eb("predecessor_task_id", "in", originalIds),
        eb("successor_task_id", "in", originalIds),
      ]),
    )
    .execute();

  if (existingEdges.length > 0) {
    await trx
      .deleteFrom("task_dependency")
      .where("workspace_id", "=", ctx.workspaceId)
      .where((eb) =>
        eb.or([
          eb("predecessor_task_id", "in", originalIds),
          eb("successor_task_id", "in", originalIds),
        ]),
      )
      .execute();
  }

  const newEdges: { workspace_id: string; predecessor_task_id: string; successor_task_id: string }[] = [];
  for (const edge of existingEdges) {
    const pred = lastPartByOriginal.get(edge.predecessor_task_id) ?? edge.predecessor_task_id;
    const succ = firstPartByOriginal.get(edge.successor_task_id) ?? edge.successor_task_id;
    if (pred !== succ) {
      newEdges.push({
        workspace_id: ctx.workspaceId,
        predecessor_task_id: pred,
        successor_task_id: succ,
      });
    }
  }
  for (const report of splitReports) {
    for (let i = 0; i < report.parts.length - 1; i++) {
      const pred = splitTaskIdMap[report.parts[i]!.task_id];
      const succ = splitTaskIdMap[report.parts[i + 1]!.task_id];
      if (pred && succ) {
        newEdges.push({
          workspace_id: ctx.workspaceId,
          predecessor_task_id: pred,
          successor_task_id: succ,
        });
      }
    }
  }
  const seen = new Set<string>();
  const deduped = newEdges.filter((edge) => {
    const key = `${edge.predecessor_task_id}->${edge.successor_task_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (deduped.length > 0) {
    await trx
      .insertInto("task_dependency")
      .values(deduped)
      .onConflict((oc) => oc.columns(["predecessor_task_id", "successor_task_id"]).doNothing())
      .execute();
  }

  await trx
    .updateTable("daily_plan_item")
    .set({ status: "deferred", updated_at: now })
    .where("workspace_id", "=", ctx.workspaceId)
    .where("task_id", "in", originalIds)
    .where("status", "=", "planned")
    .execute();

  await trx
    .updateTable("task")
    .set({ replaced_at: now, updated_at: now })
    .where("workspace_id", "=", ctx.workspaceId)
    .where("id", "in", originalIds)
    .execute();

  return splitTaskIdMap;
}

export async function applyChanges(
  trx: Transaction<Database>,
  ctx: AuthContext,
  changes: Changes,
  now: Date,
): Promise<ApplyResult> {
  const ws = ctx.workspaceId;
  const moves = changes.moves ?? [];
  const splitReports = changes.split_report ?? [];
  validateSplitApproval(splitReports, moves);
  const virtualIds = splitVirtualIds(splitReports);
  const resolutions = new Map<string, TimeFixedResolution>(
    (changes.time_fixed_resolutions ?? []).map((r) => [r.task_id, r]),
  );

  // --- Guard #4: time-fixed tasks in `moves` need an explicit choice. ---
  const moveTaskIds = [...new Set(moves.map((m) => m.task_id).filter((id) => !virtualIds.has(id)))];
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
  if (splitReports.length > 0) {
    const originalIds = splitReports.map((r) => r.original_task_id);
    const splitSourceDays = await trx
      .selectFrom("daily_plan_item as dpi")
      .innerJoin("daily_plan_day as d", "d.id", "dpi.daily_plan_day_id")
      .select("d.plan_date")
      .where("dpi.workspace_id", "=", ws)
      .where("dpi.task_id", "in", originalIds)
      .where("dpi.status", "=", "planned")
      .execute();
    for (const row of splitSourceDays) touchedDates.add(row.plan_date);
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
  const splitTaskIdMap = await materializeSplits(trx, ctx, splitReports, now);

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

  // Intra-day order = task position. Tasks that land on the SAME day must appear in
  // work-package order (task 1 before task 2…), so we process inserts ordered by
  // (to_date, task.position) and let the running max+1 numbering follow suit —
  // otherwise the day would be ordered by random task id. Positions are read AFTER
  // materializeSplits so freshly-created split parts resolve too.
  const resolveTaskId = (m: Changes["moves"][number]): string => splitTaskIdMap[m.task_id] ?? m.task_id;
  const resolvedMoveIds = [...new Set(moves.map(resolveTaskId))];
  const posRows = resolvedMoveIds.length
    ? await trx
        .selectFrom("task")
        .select(["id", "position"])
        .where("workspace_id", "=", ws)
        .where("id", "in", resolvedMoveIds)
        .execute()
    : [];
  const positionById = new Map(posRows.map((r) => [r.id, r.position]));
  const orderedMoves = [...moves].sort((a, b) => {
    const at = a.to_date ?? "";
    const bt = b.to_date ?? "";
    if (at !== bt) return at < bt ? -1 : 1;
    const ap = positionById.get(resolveTaskId(a)) ?? 0;
    const bp = positionById.get(resolveTaskId(b)) ?? 0;
    if (ap !== bp) return ap - bp;
    const ai = a.split_index ?? 0;
    const bi = b.split_index ?? 0;
    if (ai !== bi) return ai - bi;
    return a.task_id < b.task_id ? -1 : a.task_id > b.task_id ? 1 : 0;
  });

  for (const m of orderedMoves) {
    const taskId = splitTaskIdMap[m.task_id] ?? m.task_id;
    const isVirtualSplit = virtualIds.has(m.task_id);
    const res = resolutions.get(m.task_id);
    const isTimeFixed = timeFixed.has(taskId);

    // prioritize: keep the commitment exactly where it is — no defer, no insert.
    if (isTimeFixed && res?.choice === "prioritize") continue;

    // Defer the old planned item on its original day.
    if (m.from_date && !isVirtualSplit) {
      await trx
        .updateTable("daily_plan_item")
        .set({ status: "deferred", updated_at: now })
        .where("workspace_id", "=", ws)
        .where("task_id", "=", taskId)
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
        .where("id", "=", taskId)
        .execute();
      toDate = res.new_fixed_date;
    }

    if (!toDate) continue; // pure descheduling (to_date null) — just deferred.

    const day = await ensureDay(toDate);

    // A prior replan may have left a DEFERRED tombstone for this task on the target
    // day. UNIQUE (daily_plan_day_id, task_id) forbids a second row there regardless
    // of status, so re-planning the task back onto that day would otherwise trip a
    // 23505. The tombstone is moot once the task is planned here again — drop it.
    // Only 'deferred' rows are removed: 'completed' rows hold scoring history, and a
    // 'planned' row can't exist on to_date for a move (it would have been a no-op).
    await trx
      .deleteFrom("daily_plan_item")
      .where("workspace_id", "=", ws)
      .where("daily_plan_day_id", "=", day.id)
      .where("task_id", "=", taskId)
      .where("status", "=", "deferred")
      .execute();

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
        task_id: taskId,
        status: "planned",
        origin: "replanned",
        position: Number(maxPos?.m ?? -1) + 1,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    items.push(item);
  }

  return { days, items, split_task_id_map: splitTaskIdMap };
}
