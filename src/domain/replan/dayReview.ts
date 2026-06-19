import type { Kysely, Transaction } from "kysely";
import type { Database, ReplanProposal } from "../../db/types";
import type { AuthContext } from "../../auth/context";
import { withTransaction } from "../../db/transaction";
import { badRequest, conflict, notFound, unprocessable } from "../../lib/errors";
import { localDate } from "../../lib/dates";
import { recordEngagement, refreshStats } from "../engagement";
import { getRoadmap, readTaskRefs, type Roadmap, type RoadmapTaskRef } from "../roadmapRead";
import { applyChanges, type ApplyResult } from "./apply";
import { emptyChanges, type Changes, type DayDecision, type Move, type SplitReport, type TimeFixedResolution } from "./types";

export interface ReplanPreview {
  roadmap: Roadmap;
  changed_dates: string[];
  next_pending_date: string | null;
  day_decisions: DayDecision[];
  rejected_dates: string[];
  today_capacity: Changes["today_capacity"] | null;
}

export interface ReplanProposalDetailView {
  proposal: ReplanProposal;
  changes: Changes;
  refs: { tasks: Record<string, RoadmapTaskRef> };
  preview: ReplanPreview;
}

export interface DayDecisionResult extends ReplanProposalDetailView {}

export interface DecideDayOptions {
  now?: Date;
  timeFixedResolutions?: TimeFixedResolution[];
}

function normalizeChanges(input: unknown): Changes {
  return { ...emptyChanges(), ...((input ?? {}) as Changes) };
}

function moveDates(move: Move): string[] {
  return [move.from_date, move.to_date].filter((date): date is string => date != null);
}

function touchesDate(move: Move, date: string): boolean {
  return move.from_date === date || move.to_date === date;
}

function touchesAnyDate(move: Move, dates: Set<string>): boolean {
  return moveDates(move).some((date) => dates.has(date));
}

function reviewDates(changes: Changes): string[] {
  if (changes.review_dates && changes.review_dates.length > 0) {
    return [...new Set(changes.review_dates)].sort();
  }
  const dates = new Set<string>();
  for (const move of changes.moves ?? []) {
    for (const date of moveDates(move)) dates.add(date);
  }
  for (const conflict of changes.time_fixed_conflicts ?? []) {
    if (conflict.fixed_date) dates.add(conflict.fixed_date);
  }
  return [...dates].sort();
}

function decidedDates(changes: Changes): Set<string> {
  return new Set((changes.day_decisions ?? []).map((decision) => decision.date));
}

function hasDayDecisions(changes: Changes): boolean {
  return (changes.day_decisions ?? []).length > 0;
}

export function proposalHasDayDecisions(changes: Changes): boolean {
  return hasDayDecisions(changes);
}

function nextPendingDate(changes: Changes): string | null {
  const decided = decidedDates(changes);
  return reviewDates(changes).find((date) => !decided.has(date)) ?? null;
}

function activeMoves(changes: Changes): Move[] {
  const rejected = new Set(changes.rejected_dates ?? []);
  return (changes.moves ?? []).filter((move) => !touchesAnyDate(move, rejected));
}

function ensurePreviewDay(days: Map<string, Roadmap["days"][number]>, date: string): Roadmap["days"][number] {
  const existing = days.get(date);
  if (existing) return existing;
  const day: Roadmap["days"][number] = {
    date,
    status: "projected",
    is_locked: false,
    projected: true,
    items: [],
  };
  days.set(date, day);
  return day;
}

function syntheticOriginRef(original: RoadmapTaskRef, report: SplitReport, partIndex: number): RoadmapTaskRef {
  const part = report.parts[partIndex]!;
  return {
    ...original,
    id: part.task_id,
    title: part.title,
    status: "todo",
    estimate_hours: part.hours.toFixed(2),
    difficulty: null,
    is_time_fixed: false,
    fixed_date: null,
    original_task_id: report.original_task_id,
    split_index: partIndex + 1,
    split_count: report.parts.length,
    is_split_part: true,
    replaced_at: null,
    blocked: false,
  };
}

async function buildTaskRefs(
  db: Kysely<Database>,
  ctx: AuthContext,
  changes: Changes,
  taskIds: string[],
): Promise<Record<string, RoadmapTaskRef>> {
  const requested = new Set(taskIds.filter(Boolean));
  for (const move of changes.moves ?? []) requested.add(move.task_id);
  for (const conflict of changes.time_fixed_conflicts ?? []) requested.add(conflict.task_id);

  const realRefs = await readTaskRefs(db, ctx, [...requested]);
  const refs = Object.fromEntries(realRefs) as Record<string, RoadmapTaskRef>;

  const splitReports = changes.split_report ?? [];
  const originalIds = splitReports.map((report) => report.original_task_id);
  const originalRefs = await readTaskRefs(db, ctx, originalIds);
  for (const report of splitReports) {
    const original = originalRefs.get(report.original_task_id);
    if (!original) continue;
    report.parts.forEach((part, index) => {
      refs[part.task_id] = syntheticOriginRef(original, report, index);
    });
  }

  return refs;
}

function attachRefs(roadmap: Roadmap, refs: Record<string, RoadmapTaskRef>): Roadmap {
  return {
    ...roadmap,
    days: roadmap.days.map((day) => ({
      ...day,
      items: day.items.map((item) => ({ ...item, task: refs[item.task_id] ?? item.task })),
    })),
  };
}

export async function buildProposalPreview(
  db: Kysely<Database>,
  ctx: AuthContext,
  changes: Changes,
): Promise<ReplanPreview & { refs: Record<string, RoadmapTaskRef> }> {
  const base = await getRoadmap(db, ctx);
  const moves = activeMoves(changes);
  const changedTaskIds = new Set(moves.map((move) => move.task_id));
  const changedDates = reviewDates(changes);
  const days = new Map<string, Roadmap["days"][number]>();

  for (const day of base.days) {
    days.set(day.date, {
      ...day,
      items: day.items.filter((item) => item.status === "completed" || !changedTaskIds.has(item.task_id)),
    });
  }

  for (const date of changedDates) ensurePreviewDay(days, date);

  for (const move of moves) {
    if (!move.to_date) continue;
    const day = ensurePreviewDay(days, move.to_date);
    if (day.items.some((item) => item.task_id === move.task_id)) continue;
    day.items.push({
      task_id: move.task_id,
      task: null,
      status: "planned",
      origin: "replanned",
      position: day.items.length,
    });
  }

  const sortedDays = [...days.values()]
    .map((day) => ({
      ...day,
      items: day.items.map((item, position) => ({ ...item, position })),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const previewRoadmap: Roadmap = { ...base, days: sortedDays };
  const refs = await buildTaskRefs(
    db,
    ctx,
    changes,
    sortedDays.flatMap((day) => day.items.map((item) => item.task_id)),
  );

  return {
    roadmap: attachRefs(previewRoadmap, refs),
    changed_dates: changedDates,
    next_pending_date: nextPendingDate(changes),
    day_decisions: changes.day_decisions ?? [],
    rejected_dates: changes.rejected_dates ?? [],
    today_capacity: changes.today_capacity ?? null,
    refs,
  };
}

export async function getProposalDetailView(
  db: Kysely<Database>,
  ctx: AuthContext,
  proposalId: string,
): Promise<ReplanProposalDetailView> {
  const proposal = await db
    .selectFrom("replan_proposal")
    .selectAll()
    .where("id", "=", proposalId)
    .where("workspace_id", "=", ctx.workspaceId)
    .executeTakeFirst();
  if (!proposal) throw notFound("Proposal not found");
  const changes = normalizeChanges(proposal.changes);
  const preview = await buildProposalPreview(db, ctx, changes);
  return {
    proposal,
    changes,
    refs: { tasks: preview.refs },
    preview,
  };
}

function splitReportForMove(splitReports: SplitReport[], move: Move): SplitReport | undefined {
  return splitReports.find((report) => report.parts.some((part) => part.task_id === move.task_id));
}

function splitTouchedDates(report: SplitReport, moves: Move[]): string[] {
  const partIds = new Set(report.parts.map((part) => part.task_id));
  const dates = new Set<string>();
  for (const move of moves) {
    if (!partIds.has(move.task_id)) continue;
    for (const date of moveDates(move)) dates.add(date);
  }
  return [...dates];
}

function addTimeFixedMoves(
  changes: Changes,
  date: string,
  resolutions: TimeFixedResolution[],
  moves: Move[],
): void {
  const resolutionByTask = new Map(resolutions.map((resolution) => [resolution.task_id, resolution]));
  for (const conflict of changes.time_fixed_conflicts ?? []) {
    if (conflict.fixed_date !== date) continue;
    const resolution = resolutionByTask.get(conflict.task_id);
    if (!resolution) {
      throw unprocessable("Every time-fixed conflict on this day needs a decision before approval.");
    }
    if (resolution.choice === "prioritize") continue;
    if (resolution.choice === "descope") {
      moves.push({ task_id: conflict.task_id, from_date: conflict.fixed_date, to_date: null });
      continue;
    }
    if (!resolution.new_fixed_date) {
      throw unprocessable(`renegotiate of task ${conflict.task_id} requires new_fixed_date.`);
    }
    moves.push({
      task_id: conflict.task_id,
      from_date: conflict.fixed_date,
      to_date: resolution.new_fixed_date,
    });
  }
}

function approvalChangesForDate(
  changes: Changes,
  date: string,
  resolutions: TimeFixedResolution[],
): { changes: Changes; resolvedDates: string[] } {
  const rejected = new Set(changes.rejected_dates ?? []);
  const moves = activeMoves(changes);
  const splitReports = changes.split_report ?? [];
  const selectedMoves: Move[] = [];
  const selectedSplitReports = new Map<string, SplitReport>();
  const resolvedDates = new Set<string>([date]);

  for (const move of moves) {
    if (!touchesDate(move, date)) continue;
    const splitReport = splitReportForMove(splitReports, move);
    if (splitReport) {
      selectedSplitReports.set(splitReport.original_task_id, splitReport);
      for (const touched of splitTouchedDates(splitReport, moves)) {
        if (!rejected.has(touched)) resolvedDates.add(touched);
      }
      continue;
    }

    if (move.to_date === date) {
      selectedMoves.push(move);
    } else if (move.from_date === date) {
      selectedMoves.push({ ...move, to_date: null });
    }
  }

  for (const report of selectedSplitReports.values()) {
    const partIds = new Set(report.parts.map((part) => part.task_id));
    for (const move of moves) {
      if (partIds.has(move.task_id)) selectedMoves.push(move);
    }
  }

  addTimeFixedMoves(changes, date, resolutions, selectedMoves);

  return {
    changes: {
      ...changes,
      moves: selectedMoves,
      split_report: [...selectedSplitReports.values()],
      time_fixed_resolutions: resolutions,
    },
    resolvedDates: [...resolvedDates],
  };
}

function mergeAppliedChanges(
  base: Changes | null,
  increment: Changes,
  applied: ApplyResult | null,
): Changes {
  const merged: Changes = { ...emptyChanges(), ...(base ?? {}) };
  merged.moves = [...(merged.moves ?? []), ...(increment.moves ?? [])];
  merged.milestone_impacts = increment.milestone_impacts ?? merged.milestone_impacts ?? [];
  merged.time_fixed_conflicts = increment.time_fixed_conflicts ?? merged.time_fixed_conflicts ?? [];
  merged.time_fixed_resolutions = [
    ...(merged.time_fixed_resolutions ?? []),
    ...(increment.time_fixed_resolutions ?? []),
  ];
  merged.split_report = [...(merged.split_report ?? []), ...(increment.split_report ?? [])];
  if (applied && Object.keys(applied.split_task_id_map).length > 0) {
    merged.split_task_id_map = {
      ...(merged.split_task_id_map ?? {}),
      ...applied.split_task_id_map,
    };
  }
  return merged;
}

function appendDecisions(
  changes: Changes,
  dates: string[],
  status: DayDecision["status"],
  now: Date,
): Changes {
  const existing = new Set((changes.day_decisions ?? []).map((decision) => decision.date));
  const additions = dates
    .filter((date) => !existing.has(date))
    .map((date) => ({ date, status, decided_at: now.toISOString() }));
  return {
    ...changes,
    day_decisions: [...(changes.day_decisions ?? []), ...additions],
    rejected_dates:
      status === "rejected"
        ? [...new Set([...(changes.rejected_dates ?? []), ...dates])]
        : changes.rejected_dates ?? [],
  };
}

function proposalFinished(changes: Changes): boolean {
  const decided = decidedDates(changes);
  return reviewDates(changes).every((date) => decided.has(date));
}

function hasApprovedDecision(changes: Changes): boolean {
  return (changes.day_decisions ?? []).some((decision) => decision.status === "approved");
}

export async function decideProposalDay(
  db: Kysely<Database>,
  ctx: AuthContext,
  proposalId: string,
  date: string,
  status: "approved" | "rejected",
  opts: DecideDayOptions = {},
): Promise<DayDecisionResult> {
  const now = opts.now ?? new Date();
  const today = localDate(ctx.timezone, now);
  await withTransaction(db, async (trx: Transaction<Database>) => {
    const existing = await trx
      .selectFrom("replan_proposal")
      .selectAll()
      .where("id", "=", proposalId)
      .where("workspace_id", "=", ctx.workspaceId)
      .forUpdate()
      .executeTakeFirst();
    if (!existing) throw notFound("Proposal not found");
    if (existing.status !== "pending") {
      throw conflict(`Proposal is '${existing.status}', not 'pending' — cannot review a day`);
    }

    const originalChanges = normalizeChanges(existing.changes);
    const dates = reviewDates(originalChanges);
    if (!dates.includes(date)) throw badRequest("date is not part of this proposal review");
    if (decidedDates(originalChanges).has(date)) throw conflict("This proposal day has already been decided");

    let nextChanges = originalChanges;
    let nextApplied = normalizeChanges(existing.applied_changes);

    if (status === "approved") {
      const selected = approvalChangesForDate(originalChanges, date, opts.timeFixedResolutions ?? []);
      const applied =
        selected.changes.moves.length > 0 || (selected.changes.split_report ?? []).length > 0
          ? await applyChanges(trx, ctx, selected.changes, now)
          : null;
      nextApplied = mergeAppliedChanges(nextApplied, selected.changes, applied);
      nextChanges = appendDecisions(nextChanges, selected.resolvedDates, "approved", now);
    } else {
      nextChanges = appendDecisions(nextChanges, [date], "rejected", now);
    }

    const finished = proposalFinished(nextChanges);
    const finalStatus = finished ? (hasApprovedDecision(nextChanges) ? "edited_approved" : "rejected") : "pending";

    await trx
      .updateTable("replan_proposal")
      .set({
        status: finalStatus,
        changes: JSON.stringify(nextChanges),
        applied_changes: hasApprovedDecision(nextChanges) ? JSON.stringify(nextApplied) : null,
        resolved_by_user_id: finished ? ctx.userId : existing.resolved_by_user_id,
        resolved_at: finished ? now : existing.resolved_at,
      })
      .where("id", "=", proposalId)
      .execute();

    if (finished) {
      await recordEngagement(trx, { userId: ctx.userId, workspaceId: ctx.workspaceId, localDate: today, now });
      await refreshStats(trx, { userId: ctx.userId, workspaceId: ctx.workspaceId, localToday: today, now });
    }
  });

  return getProposalDetailView(db, ctx, proposalId);
}
