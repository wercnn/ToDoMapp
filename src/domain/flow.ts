/**
 * Project Flow Diagram (api-endpoints.md §5, data-model.md §6). A fully-DERIVED
 * read: node statuses, the dependency edges, the critical path to the next
 * unachieved milestone, and that milestone's headline. Nothing is written.
 *
 * The critical path is the longest path BY ESTIMATE SUM (difficulty mapped to
 * nominal hours via the planner constant) through the task DAG, ending at a task
 * in the next milestone's work-package set. The task DAG has two edge sources:
 *   - task position inside a work package — task n precedes task n+1.
 *   - `work_package_dependency` — EXPANDED to task level: an upstream WP edge
 *     means every task in the predecessor WP precedes every task in the successor
 *     WP (an m×n fan-out, directed predecessor→successor). This expansion is the
 *     bug-prone bit; see tests/flow.test.ts for the WP-driven critical-path case.
 *
 * "Today" for the in-progress derivation is midnight-LOCAL (`app_user.timezone`,
 * invariant #3), never the server clock — `now` is injectable for that reason.
 */
import type { Kysely } from "kysely";
import type { Database } from "../db/types";
import type { AuthContext } from "../auth/context";
import { notFound } from "../lib/errors";
import { localDate } from "../lib/dates";
import { resolveHours } from "../planner/constants";
import { getBlockedTaskIds } from "./blocked";
import { scheduledMilestoneDates } from "./scheduleDates";
import { derivePositionTaskDependencies } from "./taskPositionDependencies";

export type DerivedStatus = "done" | "blocked" | "in_progress" | "open";

export interface FlowNode {
  id: string;
  kind: "work_package" | "task";
  title: string;
  /** Set for task nodes — the owning work package. */
  work_package_id?: string;
  /** Nominal planning hours (difficulty already mapped; unestimated → default). */
  hours: number;
  derived_status: DerivedStatus;
}

export interface FlowEdges {
  task: { predecessor_task_id: string; successor_task_id: string }[];
  work_package: { predecessor_wp_id: string; successor_wp_id: string }[];
}

export interface ProjectFlow {
  nodes: FlowNode[];
  edges: FlowEdges;
  critical_path: string[];
  next_milestone: { id: string; title: string; projected_date: string | null } | null;
}

/** Longest path by summed node weight, ending at any node in `endSet`. Pure. */
export function longestPath(
  nodes: { id: string; weight: number }[],
  edges: [from: string, to: string][],
  endSet: Set<string>,
): string[] {
  const weight = new Map(nodes.map((n) => [n.id, n.weight]));
  const adj = new Map<string, string[]>(); // from → [to]
  const indeg = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  for (const [from, to] of edges) {
    if (!weight.has(from) || !weight.has(to)) continue;
    (adj.get(from) ?? adj.set(from, []).get(from)!).push(to);
    indeg.set(to, (indeg.get(to) ?? 0) + 1);
  }

  // Kahn topological order (the graph is acyclic — invariant #1).
  const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: string[] = [];
  const deg = new Map(indeg);
  while (queue.length > 0) {
    const n = queue.shift()!;
    order.push(n);
    for (const m of adj.get(n) ?? []) {
      deg.set(m, deg.get(m)! - 1);
      if (deg.get(m) === 0) queue.push(m);
    }
  }

  // DP: best[n] = heaviest path ending at n; prev[n] reconstructs it.
  const best = new Map<string, number>();
  const prev = new Map<string, string | null>();
  for (const n of order) {
    best.set(n, weight.get(n)!);
    prev.set(n, null);
  }
  for (const n of order) {
    for (const m of adj.get(n) ?? []) {
      const cand = best.get(n)! + weight.get(m)!;
      if (cand > best.get(m)!) {
        best.set(m, cand);
        prev.set(m, n);
      }
    }
  }

  // Pick the heaviest path that ENDS at a milestone-set task.
  let endId: string | null = null;
  let endBest = -Infinity;
  for (const id of endSet) {
    const b = best.get(id);
    if (b != null && b > endBest) {
      endBest = b;
      endId = id;
    }
  }
  if (endId == null) return [];

  const path: string[] = [];
  for (let cur: string | null = endId; cur != null; cur = prev.get(cur) ?? null) {
    path.push(cur);
  }
  return path.reverse();
}

export async function getProjectFlow(
  db: Kysely<Database>,
  ctx: AuthContext,
  projectId: string,
  now: Date = new Date(),
): Promise<ProjectFlow> {
  const project = await db
    .selectFrom("project")
    .select("id")
    .where("id", "=", projectId)
    .where("workspace_id", "=", ctx.workspaceId)
    .executeTakeFirst();
  if (!project) throw notFound("Project not found");

  const today = localDate(ctx.timezone, now);

  const wps = await db
    .selectFrom("work_package")
    .select(["id", "title", "milestone_id", "completed_at", "estimate_hours", "difficulty"])
    .where("workspace_id", "=", ctx.workspaceId)
    .where("project_id", "=", projectId)
    .orderBy("position")
    .execute();
  const wpIds = wps.map((w) => w.id);

  const tasks = wpIds.length
    ? await db
        .selectFrom("task")
        .select([
          "id",
          "work_package_id",
          "title",
          "status",
          "estimate_hours",
          "difficulty",
          "position",
          "replaced_at",
        ])
        .where("workspace_id", "=", ctx.workspaceId)
        .where("work_package_id", "in", wpIds)
        .where("replaced_at", "is", null)
        .orderBy("position")
        .execute()
    : [];
  const taskIds = new Set(tasks.map((t) => t.id));

  const taskEdges = derivePositionTaskDependencies(
    tasks.map((task) => ({
      id: task.id,
      workPackageId: task.work_package_id,
      position: task.position,
      status: task.status,
      replacedAt: task.replaced_at,
    })),
  ).map((edge) => ({
    predecessor_task_id: edge.predecessorTaskId,
    successor_task_id: edge.successorTaskId,
  }));

  const wpIdSet = new Set(wpIds);
  const wpEdges = (
    await db
      .selectFrom("work_package_dependency")
      .select(["predecessor_wp_id", "successor_wp_id"])
      .where("workspace_id", "=", ctx.workspaceId)
      .execute()
  ).filter((e) => wpIdSet.has(e.predecessor_wp_id) && wpIdSet.has(e.successor_wp_id));

  // Tasks planned on *today's* day-step (local) → drives in_progress.
  const plannedTodayRows = taskIds.size
    ? await db
        .selectFrom("daily_plan_item as i")
        .innerJoin("daily_plan_day as d", "d.id", "i.daily_plan_day_id")
        .select("i.task_id as task_id")
        .where("i.workspace_id", "=", ctx.workspaceId)
        .where("i.status", "=", "planned")
        .where("d.plan_date", "=", today)
        .where("i.task_id", "in", [...taskIds])
        .execute()
    : [];
  const plannedToday = new Set(plannedTodayRows.map((r) => r.task_id));

  const blocked = await getBlockedTaskIds(db, ctx);

  // --- Node assembly + status derivation ---
  const tasksByWp = new Map<string, typeof tasks>();
  for (const t of tasks) {
    (tasksByWp.get(t.work_package_id) ?? tasksByWp.set(t.work_package_id, []).get(t.work_package_id)!).push(t);
  }
  // A WP is blocked if any upstream (predecessor) WP is not yet complete.
  const wpDone = new Set(wps.filter((w) => w.completed_at != null).map((w) => w.id));
  const blockedWp = new Set<string>();
  for (const e of wpEdges) {
    if (!wpDone.has(e.predecessor_wp_id)) blockedWp.add(e.successor_wp_id);
  }

  const nodes: FlowNode[] = [];
  for (const w of wps) {
    const children = tasksByWp.get(w.id) ?? [];
    let status: DerivedStatus;
    if (w.completed_at != null) status = "done";
    else if (blockedWp.has(w.id)) status = "blocked";
    else if (children.some((t) => t.status === "done" || plannedToday.has(t.id)))
      status = "in_progress";
    else status = "open";
    nodes.push({
      id: w.id,
      kind: "work_package",
      title: w.title,
      hours: resolveHours(w.estimate_hours != null ? Number(w.estimate_hours) : null, w.difficulty),
      derived_status: status,
    });
  }
  for (const t of tasks) {
    let status: DerivedStatus;
    if (t.status === "done") status = "done";
    else if (blocked.has(t.id)) status = "blocked";
    else if (plannedToday.has(t.id)) status = "in_progress";
    else status = "open";
    nodes.push({
      id: t.id,
      kind: "task",
      title: t.title,
      work_package_id: t.work_package_id,
      hours: resolveHours(t.estimate_hours != null ? Number(t.estimate_hours) : null, t.difficulty),
      derived_status: status,
    });
  }

  // --- Next unachieved milestone (first by position) ---
  const nextMs = await db
    .selectFrom("milestone")
    .select(["id", "title"])
    .where("workspace_id", "=", ctx.workspaceId)
    .where("project_id", "=", projectId)
    .where("achieved_at", "is", null)
    .orderBy("position")
    .limit(1)
    .executeTakeFirst();

  // --- Critical path to that milestone's work-package set ---
  let criticalPath: string[] = [];
  if (nextMs) {
    const milestoneWpIds = new Set(wps.filter((w) => w.milestone_id === nextMs.id).map((w) => w.id));
    const endSet = new Set(tasks.filter((t) => milestoneWpIds.has(t.work_package_id)).map((t) => t.id));
    if (endSet.size > 0) {
      // Expand WP edges to task level: predecessor-WP tasks → successor-WP tasks.
      const dagEdges: [string, string][] = taskEdges.map((e) => [
        e.predecessor_task_id,
        e.successor_task_id,
      ]);
      for (const e of wpEdges) {
        const preds = tasksByWp.get(e.predecessor_wp_id) ?? [];
        const succs = tasksByWp.get(e.successor_wp_id) ?? [];
        for (const p of preds) for (const s of succs) dagEdges.push([p.id, s.id]);
      }
      const dagNodes = tasks.map((t) => ({
        id: t.id,
        weight: resolveHours(t.estimate_hours != null ? Number(t.estimate_hours) : null, t.difficulty),
      }));
      criticalPath = longestPath(dagNodes, dagEdges, endSet);
    }
  }

  // Phase 6 activation: projected_date for the next milestone is now derived from
  // the shared projection (data-model §6 — computed live, never stored).
  let nextMsDate: string | null = null;
  if (nextMs) {
    const milestoneDates = await scheduledMilestoneDates(db, ctx, { now });
    nextMsDate = milestoneDates.get(nextMs.id) ?? null;
  }

  return {
    nodes,
    edges: { task: taskEdges, work_package: wpEdges },
    critical_path: criticalPath,
    next_milestone: nextMs
      ? { id: nextMs.id, title: nextMs.title, projected_date: nextMsDate }
      : null,
  };
}
