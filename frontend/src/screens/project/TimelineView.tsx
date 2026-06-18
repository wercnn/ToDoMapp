/**
 * Timeline / Gantt view (web-screens §C.2) — hand-rolled (no second heavy dep):
 * a day-axis grid, one row per task, bars in each task's scheduled day.
 *
 * THE PRINCIPLE-1 KEYSTONE — a cross-day drag PROPOSES, never silently rewrites:
 *   Dragging a FLEXIBLE bar to a different day does NOT PATCH/reschedule. It fires
 *   POST /replan-proposals { trigger:'user_request', scope:{ project_id, from_date } }
 *   (from_date = the earlier of the bar's day and the drop day — the re-plan anchor)
 *   and hands the resulting proposal to the shared ReplanReview (via onProposal). The
 *   drag is a REQUEST to re-plan, not the change. Because the backend has no per-task
 *   target-date input (tracked gap in PROGRESS), the drop day is an ANCHOR, not a
 *   guaranteed slot — the gesture reads "re-plan from here," never "pin to this day."
 *
 *   TIME-FIXED bars are drag-DISABLED (pinned, Decision #7) with a pin affordance, so
 *   a pinned bar reads as intentional, not broken. Any time-fixed conflict the re-plan
 *   surfaces flows through ReplanReview's existing force-resolve-all section.
 *
 * Within-list REORDER is NOT here — that's the WP sheet's position PATCH. Every drag
 * on this axis is a day change ⇒ always a proposal.
 *
 * Reads: WPs + tasks (per-WP, bounded fan-out — the Timeline needs is_time_fixed/
 * fixed_date which flow/roadmap omit; a future bulk project-tasks read would remove
 * the fan-out), the roadmap (task→date), and milestones (projected markers).
 */
import { useMemo, useState } from "react";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import type { Roadmap, TaskWithBlocked } from "@api-types";
import { replanApi, roadmapApi, workPackagesApi } from "@/api";
import { StatusPill } from "@/components/StatusPill";
import { calmMessage } from "@/lib/apiError";
import { cn } from "@/lib/utils";
import { useWorkPackages, useMilestones } from "./useProjectData";
import { formatEstimate, taskStatusKind } from "./status";

const DAY_MS = 86_400_000;
function addDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00") - Date.parse(a + "T00:00:00")) / DAY_MS);
}

export function TimelineView({
  projectId,
  onProposal,
}: {
  projectId: string;
  onProposal?: (proposalId: string) => void;
}) {
  const wps = useWorkPackages(projectId);
  const milestones = useMilestones(projectId);
  const roadmap = useQuery({ queryKey: ["roadmap"], queryFn: () => roadmapApi.get() });

  // Bounded fan-out: one listTasks per WP (Timeline needs full task fields).
  const wpIds = (wps.data ?? []).map((w) => w.id);
  const taskQueries = useQueries({
    queries: wpIds.map((id) => ({
      queryKey: ["work-package", id, "tasks"],
      queryFn: () => workPackagesApi.listTasks(id),
    })),
  });

  const [notice, setNotice] = useState<string | null>(null);
  const [zoom, setZoom] = useState<"day" | "week" | "month">("day");

  const propose = useMutation({
    mutationFn: (fromDate: string) => replanApi.create({ project_id: projectId, from_date: fromDate }),
    onSuccess: (proposal) => {
      setNotice("Re-plan requested — review the proposal before it changes your plan.");
      onProposal?.(proposal.id);
    },
    onError: (e) => setNotice(calmMessage(e)),
  });

  // task_id → scheduled date (planned/non-deferred items only).
  const scheduledDate = useMemo(() => {
    const map = new Map<string, string>();
    const rm = roadmap.data as Roadmap | undefined;
    for (const day of rm?.days ?? []) {
      for (const item of day.items) {
        if (item.status !== "deferred" && item.task_id) map.set(item.task_id, day.date);
      }
    }
    return map;
  }, [roadmap.data]);

  // Flatten tasks per WP, in WP/position order, attaching the scheduled date.
  const rows = useMemo(() => {
    const msTitle = new Map((milestones.data ?? []).map((m) => [m.id, m.title]));
    const out: { milestone: string; wpTitle: string; task: TaskWithBlocked; date: string | null }[] = [];
    (wps.data ?? []).forEach((wp, i) => {
      const tasks = taskQueries[i]?.data ?? [];
      for (const t of tasks) {
        out.push({
          milestone: wp.milestone_id ? msTitle.get(wp.milestone_id) ?? "Milestone" : "No milestone",
          wpTitle: wp.title,
          task: t,
          date: scheduledDate.get(t.id) ?? null,
        });
      }
    });
    return out;
  }, [wps.data, taskQueries, scheduledDate, milestones.data]);

  // Day axis range: today ∪ scheduled dates ∪ milestone projected dates, padded.
  const today = (roadmap.data as Roadmap | undefined)?.position.today ?? new Date().toISOString().slice(0, 10);
  const axis = useMemo(() => {
    const dates = [today];
    for (const r of rows) if (r.date) dates.push(r.date);
    for (const m of milestones.data ?? []) if (m.projected_date) dates.push(m.projected_date);
    const min = dates.reduce((a, b) => (a < b ? a : b));
    const max = dates.reduce((a, b) => (a > b ? a : b));
    const start = addDays(min, -1);
    const span = Math.max(diffDays(start, max) + 2, 7);
    return { start, days: Array.from({ length: span }, (_, i) => addDays(start, i)) };
  }, [rows, milestones.data, today]);

  if (wps.isLoading || roadmap.isLoading)
    return <p className="p-6 text-sm font-bold text-text-tertiary">Loading timeline…</p>;
  if (!wps.data?.length)
    return <p className="p-6 text-sm font-bold text-text-tertiary">No work packages to schedule yet.</p>;

  const colW = zoom === "day" ? 64 : zoom === "week" ? 44 : 30;
  const gridCols = `220px repeat(${axis.days.length}, ${colW}px)`;
  const milestoneByDate = new Map<string, string[]>();
  for (const m of milestones.data ?? []) {
    if (!m.projected_date) continue;
    (milestoneByDate.get(m.projected_date) ?? milestoneByDate.set(m.projected_date, []).get(m.projected_date)!).push(
      m.title,
    );
  }

  function onDropOnDay(task: TaskWithBlocked, fromDate: string, toDate: string) {
    if (toDate === fromDate) return;
    if (task.is_time_fixed) return; // pinned — drag is disabled, this is a guard
    propose.mutate(fromDate < toDate ? fromDate : toDate);
  }

  return (
    <div className="flex flex-col gap-2">
      {notice && (
        <p className="rounded-[10px] bg-system-soft px-3 py-2 text-xs font-bold text-system">{notice}</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-[11px] font-semibold text-text-tertiary">
          Drag a flexible bar to a new day to <strong>re-plan from there</strong>. Pinned{" "}
          <span className="text-text-secondary">◆</span> bars can’t be dragged.
        </p>
        <div className="inline-flex rounded-[10px] border border-border bg-surface-1 p-0.5">
          {(["day", "week", "month"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setZoom(option)}
              className={cn(
                "rounded-[8px] px-3 py-1.5 text-xs font-black capitalize",
                zoom === option ? "bg-surface-3 text-text-primary" : "text-text-tertiary hover:text-text-primary",
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-[14px] border border-border">
        {/* header: dates */}
        <div className="grid items-end" style={{ gridTemplateColumns: gridCols }}>
          <div className="sticky left-0 z-10 bg-surface-2 px-3 py-2 text-[10px] font-extrabold uppercase tracking-wider text-text-tertiary">
            Task
          </div>
          {axis.days.map((d) => {
            const isToday = d === today;
            const labels = milestoneByDate.get(d);
            return (
              <div
                key={d}
                className={cn(
                  "border-l border-border px-1 py-2 text-center text-[9px] font-bold",
                  isToday ? "bg-progress-soft text-progress" : "bg-surface-2 text-text-tertiary",
                )}
                title={labels ? `Milestone: ${labels.join(", ")}` : undefined}
              >
                {labels && <div className="text-system">◆</div>}
                {d.slice(5)}
              </div>
            );
          })}
        </div>

        {/* one row per task */}
        {groupRows(rows).map((entry) =>
          entry.kind === "group" ? (
            <div
              key={`group-${entry.title}`}
              className="grid items-center border-t border-border/60 bg-surface-2/70"
              style={{ gridTemplateColumns: gridCols }}
            >
              <div className="sticky left-0 z-10 bg-surface-2/95 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-system">
                {entry.title}
              </div>
              <div className="col-span-full h-full" />
            </div>
          ) : (
            <div
              key={entry.task.id}
              className="grid items-center border-t border-border/60"
              style={{ gridTemplateColumns: gridCols }}
            >
              <div className="sticky left-0 z-10 flex items-center gap-1.5 bg-bg px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-text-primary">
                  {entry.task.title}
                </span>
                <span className="hidden flex-none text-[9px] font-semibold text-text-tertiary sm:inline">
                  {entry.wpTitle}
                </span>
              </div>
              {axis.days.map((d) => {
                const here = entry.date === d;
                return (
                  <div
                    key={d}
                    className={cn("h-full border-l border-border/40 px-0.5 py-1.5", d === today && "bg-progress-soft/40")}
                    onDragOver={(e) => {
                      if (entry.date && !entry.task.is_time_fixed) e.preventDefault();
                    }}
                    onDrop={() => entry.date && onDropOnDay(entry.task, entry.date, d)}
                  >
                    {here && (
                      <div
                        draggable={!entry.task.is_time_fixed}
                        onDragStart={(e) => e.dataTransfer.setData("text/plain", entry.task.id)}
                        title={
                          entry.task.is_time_fixed
                            ? `Pinned to ${entry.task.fixed_date ?? entry.date} — time-fixed, can’t be dragged.`
                            : "Drag to a new day to re-plan from there"
                        }
                        className={cn(
                          "flex items-center justify-center gap-1 rounded-[7px] px-1 py-1 text-[10px] font-bold",
                          entry.task.is_time_fixed
                            ? "cursor-not-allowed border border-border-strong bg-surface-2 text-text-secondary"
                            : "cursor-grab bg-info-soft text-info active:cursor-grabbing",
                          entry.task.status === "done" && "bg-progress-soft text-progress",
                        )}
                      >
                        {entry.task.is_time_fixed ? <span aria-hidden>◆</span> : <StatusPill status={taskStatusKind(entry.task)} />}
                        <span className="truncate">{formatEstimate(entry.task.estimate_hours, entry.task.difficulty)}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function groupRows<T extends { milestone: string }>(rows: T[]) {
  const out: ({ kind: "group"; title: string } | ({ kind: "row" } & T))[] = [];
  let current = "";
  for (const row of rows) {
    if (row.milestone !== current) {
      current = row.milestone;
      out.push({ kind: "group", title: current });
    }
    out.push({ kind: "row", ...row });
  }
  return out;
}
