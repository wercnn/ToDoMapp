/**
 * Full-width Roadmap path with filters and a right-side context drawer. Writes
 * stay deliberate: proposed days can be confirmed, locked/unlocked, adjusted in
 * the existing day drawer, and replans always surface as proposals.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, Flag, Lock, MapPin, RefreshCw, SlidersHorizontal, Unlock } from "lucide-react";
import type { RoadmapDay, RoadmapItem } from "@api-types";
import { daysApi, goalsApi, replanApi, roadmapApi } from "@/api";
import { Button } from "@/components/ui/button";
import { StatusPill, type StatusKind } from "@/components/StatusPill";
import { Skeleton } from "@/components/Skeleton";
import { cn } from "@/lib/utils";
import { calmMessage } from "@/lib/apiError";
import { DayDrawer } from "./DayDrawer";
import { ReplanReview } from "./ReplanReview";
import { buildTimeline } from "./timeline";
import { formatDay } from "./dates";

const DAY_PILL: Record<RoadmapDay["status"], StatusKind> = {
  proposed: "proposed",
  confirmed: "confirmed",
  completed: "completed",
  slipped: "slipped",
  projected: "open",
};

export function Roadmap() {
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const [goalId, setGoalId] = useState("");
  const [from, setFrom] = useState(searchParams.get("from") ?? "");
  const [to, setTo] = useState(searchParams.get("to") ?? "");
  const [openDate, setOpenDate] = useState<string | null>(searchParams.get("date"));
  const [selectedDate, setSelectedDate] = useState<string | null>(searchParams.get("date"));
  const [reviewId, setReviewId] = useState<string | null>(searchParams.get("proposal"));
  const [autoOpenedProposal, setAutoOpenedProposal] = useState(false);
  const [replanError, setReplanError] = useState<string | null>(null);

  const goals = useQuery({ queryKey: ["goals"], queryFn: goalsApi.list });
  const roadmap = useQuery({
    queryKey: ["roadmap", { goalId, from, to }],
    queryFn: () =>
      roadmapApi.get({
        ...(goalId ? { goal_id: goalId } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      }),
  });
  const pending = useQuery({ queryKey: ["replan-proposals", "pending"], queryFn: () => replanApi.list("pending") });

  const timeline = useMemo(() => (roadmap.data ? buildTimeline(roadmap.data) : null), [roadmap.data]);
  const today = roadmap.data?.position.today ?? null;
  const pendingProposal = pending.data?.[0] ?? null;
  const selectedDay =
    roadmap.data?.days.find((day) => day.date === selectedDate) ??
    roadmap.data?.days.find((day) => day.date === today) ??
    roadmap.data?.days[0] ??
    null;

  useEffect(() => {
    if (!selectedDate && selectedDay) setSelectedDate(selectedDay.date);
  }, [selectedDate, selectedDay]);

  useEffect(() => {
    if (pendingProposal && !reviewId && !autoOpenedProposal) {
      setReviewId(pendingProposal.id);
      setAutoOpenedProposal(true);
    }
  }, [autoOpenedProposal, pendingProposal, reviewId]);

  const requestReplan = useMutation({
    mutationFn: () => replanApi.create(from ? { from_date: from } : undefined),
    onMutate: () => setReplanError(null),
    onError: (err) => setReplanError(calmMessage(err)),
    onSuccess: async (proposal) => {
      await pending.refetch();
      setReviewId(proposal.id);
    },
  });
  const proposeMore = useMutation({
    mutationFn: () => roadmapApi.propose({ horizon_days: 14, ...(goalId ? { goal_id: goalId } : {}) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["roadmap"] });
      void qc.invalidateQueries({ queryKey: ["morning-brief"] });
    },
  });

  if (roadmap.isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-[260px] w-full" />
      </div>
    );
  }
  if (roadmap.isError || !timeline) {
    return <div className="p-6 text-sm font-bold text-warning">{calmMessage(roadmap.error)}</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-none flex-wrap items-end gap-3 border-b border-border bg-bg px-6 py-4">
        <div className="mr-auto">
          <h2 className="text-xl font-black">Roadmap</h2>
          <p className="mt-0.5 text-xs font-semibold text-text-tertiary">
            Confirmed days are committed. Lilac days are proposed or projected by the system.
          </p>
        </div>
        <select
          value={goalId}
          onChange={(event) => setGoalId(event.target.value)}
          className="h-9 rounded-[9px] border border-border bg-surface-1 px-3 text-xs font-bold outline-none focus:border-progress"
        >
          <option value="">All goals</option>
          {goals.data?.map((goal) => (
            <option key={goal.id} value={goal.id}>
              {goal.title}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          className="h-9 rounded-[9px] border border-border bg-surface-1 px-3 text-xs font-bold outline-none focus:border-progress"
          aria-label="From date"
        />
        <input
          type="date"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          className="h-9 rounded-[9px] border border-border bg-surface-1 px-3 text-xs font-bold outline-none focus:border-progress"
          aria-label="To date"
        />
        <Button size="sm" variant="outline" onClick={() => proposeMore.mutate()} disabled={proposeMore.isPending}>
          <CalendarDays size={14} />
          Propose more days
        </Button>
        {pendingProposal ? (
          <Button variant="system" size="sm" onClick={() => setReviewId(pendingProposal.id)}>
            Review proposal
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => requestReplan.mutate()} disabled={requestReplan.isPending}>
            <RefreshCw size={14} className={cn(requestReplan.isPending && "animate-spin")} />
            {requestReplan.isPending ? "Analyzing..." : "Replan"}
          </Button>
        )}
      </header>

      {replanError && (
        <p className="border-b border-border bg-warning-soft px-6 py-2 text-xs font-bold text-warning">{replanError}</p>
      )}

      {timeline.entries.length === 0 ? (
        <div className="p-6">
          <h3 className="text-lg font-black">No days yet</h3>
          <p className="mt-2 text-sm font-semibold text-text-tertiary">
            Finish onboarding or propose more days to build the path.
          </p>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="min-w-0 overflow-auto p-6">
            <div className="relative min-h-[420px] min-w-max rounded-[16px] border border-border bg-surface-1 p-6">
              <div className="absolute left-12 right-12 top-[92px] h-1 rounded-full bg-border" />
              <div className="relative flex items-start gap-5">
                {timeline.entries.map((entry) =>
                  entry.kind === "day" ? (
                    <PathDay
                      key={`day-${entry.date}`}
                      day={entry.day}
                      today={today}
                      selected={entry.date === selectedDay?.date}
                      onSelect={() => setSelectedDate(entry.date)}
                    />
                  ) : (
                    <PathMilestone
                      key={`ms-${entry.id}-${entry.date}`}
                      date={entry.date}
                      title={entry.title}
                      achieved={entry.achieved}
                    />
                  ),
                )}
              </div>
            </div>
            {timeline.undated.length > 0 && (
              <p className="mt-3 text-[11px] font-semibold text-text-tertiary">
                {timeline.undated.length} milestone{timeline.undated.length === 1 ? "" : "s"} not yet datable.
              </p>
            )}
          </section>

          <DayContextPanel
            day={selectedDay}
            today={today}
            onOpenDrawer={(date) => setOpenDate(date)}
            onRefresh={() => {
              void qc.invalidateQueries({ queryKey: ["roadmap"] });
              void qc.invalidateQueries({ queryKey: ["morning-brief"] });
            }}
          />
        </div>
      )}

      <DayDrawer date={openDate} onClose={() => setOpenDate(null)} today={today} />
      <ReplanReview proposalId={reviewId} onClose={() => setReviewId(null)} />
    </div>
  );
}

function PathDay({
  day,
  today,
  selected,
  onSelect,
}: {
  day: RoadmapDay;
  today: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const isToday = day.date === today;
  const { weekday, rest } = formatDay(day.date);
  const count = day.items.length;
  const doneCount = day.items.filter((item) => item.status === "completed").length;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "relative flex w-[170px] flex-col items-center gap-3 rounded-[14px] border px-3 py-4 text-center transition-colors",
        selected ? "border-progress bg-progress-soft" : "border-border bg-bg hover:bg-surface-2",
        day.projected && "border-dashed",
      )}
    >
      <span
        className={cn(
          "grid h-12 w-12 place-items-center rounded-full border-2 shadow-[0_0_0_8px_var(--surface-1)]",
          isToday
            ? "border-progress bg-progress text-on-accent"
            : day.projected || day.status === "proposed"
              ? "border-system bg-system-soft text-system"
              : "border-border-strong bg-surface-2 text-text-secondary",
        )}
      >
        {isToday ? <MapPin size={17} /> : doneCount > 0 ? `${doneCount}/${count}` : count || ""}
      </span>
      <div>
        <p className="font-mono text-sm font-black text-text-primary">{rest}</p>
        <p className="text-[10px] font-black uppercase tracking-wider text-text-tertiary">{weekday}</p>
      </div>
      <StatusPill status={DAY_PILL[day.status]} label={day.projected ? "Projected" : undefined} />
      <p className="text-xs font-bold text-text-secondary">{count} task{count === 1 ? "" : "s"}</p>
    </button>
  );
}

function PathMilestone({ date, title, achieved }: { date: string; title: string; achieved: boolean }) {
  const { rest } = formatDay(date);
  return (
    <div className="relative flex w-[150px] flex-col items-center gap-3 px-2 py-4 text-center">
      <span
        className={cn(
          "grid h-12 w-12 rotate-45 place-items-center rounded-[10px] border-2 shadow-[0_0_0_8px_var(--surface-1)]",
          achieved ? "border-progress bg-progress text-on-accent" : "border-system bg-system-soft text-system",
        )}
      >
        <Flag size={17} className="-rotate-45" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-black text-text-primary">{title}</p>
        <p className="font-mono text-[11px] font-bold text-text-tertiary">{achieved ? rest : `~${rest}`}</p>
      </div>
    </div>
  );
}

function DayContextPanel({
  day,
  today,
  onOpenDrawer,
  onRefresh,
}: {
  day: RoadmapDay | null;
  today: string | null;
  onOpenDrawer: (date: string) => void;
  onRefresh: () => void;
}) {
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: onRefresh,
  });
  if (!day) {
    return (
      <aside className="border-l border-border bg-bg p-5 text-sm font-semibold text-text-tertiary">
        Select a day to inspect.
      </aside>
    );
  }

  const { weekday, rest } = formatDay(day.date);
  const groups = groupRoadmapItems(day.items);
  const canConfirm = day.status === "proposed";
  const canLock = !day.projected && day.status !== "completed";

  return (
    <aside className="min-h-0 overflow-y-auto border-l border-border bg-bg p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black uppercase tracking-wider text-text-tertiary">{weekday}</p>
          <h3 className="font-mono text-xl font-black">{rest}</h3>
          {day.date === today && <p className="mt-1 text-xs font-black text-progress">You are here</p>}
        </div>
        <StatusPill status={DAY_PILL[day.status]} label={day.projected ? "Projected" : undefined} />
      </div>

      <div className="mb-5 grid grid-cols-3 gap-2">
        <Button
          size="sm"
          disabled={!canConfirm || run.isPending}
          onClick={() => run.mutate(() => daysApi.confirm(day.date))}
        >
          Confirm
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!canLock || run.isPending}
          onClick={() => run.mutate(() => daysApi.setLock(day.date, !day.is_locked))}
        >
          {day.is_locked ? <Unlock size={14} /> : <Lock size={14} />}
          {day.is_locked ? "Unlock" : "Lock"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={day.projected}
          onClick={() => onOpenDrawer(day.date)}
        >
          <SlidersHorizontal size={14} />
          Adjust
        </Button>
      </div>

      {day.projected && (
        <p className="mb-4 rounded-[12px] border border-dashed border-system/40 bg-system-soft px-3 py-2 text-xs font-bold text-system">
          This is a live projection. Use Propose more days before confirming or editing it.
        </p>
      )}

      <div className="space-y-4">
        {groups.map((group) => (
          <section key={group.key} className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-progress" />
              <p className="min-w-0 truncate text-xs font-black uppercase tracking-wider text-text-tertiary">
                {group.project}
              </p>
            </div>
            <p className="-mt-1 pl-4 text-xs font-extrabold text-text-secondary">{group.workPackage}</p>
            {group.items.map((item) => (
              <div key={item.task_id} className="rounded-[10px] border border-border bg-surface-1 px-3 py-2">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 text-sm font-extrabold text-text-primary">
                    {item.task?.title ?? "Task"}
                  </p>
                  {item.task?.is_time_fixed && <StatusPill status="time_fixed" />}
                  {item.task?.blocked && <StatusPill status="blocked" />}
                </div>
                <p className="mt-1 text-[11px] font-semibold text-text-tertiary">
                  {item.status ?? "planned"} · {item.origin ?? "projected"}
                  {item.task?.estimate_hours ? ` · ${Number(item.task.estimate_hours).toFixed(1)}h` : ""}
                </p>
              </div>
            ))}
          </section>
        ))}
        {groups.length === 0 && (
          <p className="rounded-[12px] border border-border bg-surface-1 p-3 text-sm font-semibold text-text-tertiary">
            No tasks on this day.
          </p>
        )}
      </div>
    </aside>
  );
}

function groupRoadmapItems(items: RoadmapItem[]) {
  const groups = new Map<
    string,
    { key: string; project: string; workPackage: string; items: RoadmapItem[] }
  >();
  for (const item of items) {
    const task = item.task;
    const key = task ? `${task.project_id}:${task.work_package_id}` : "unknown";
    const group =
      groups.get(key) ??
      {
        key,
        project: task?.project_title ?? "Unassigned project",
        workPackage: task?.work_package_title ?? "Unassigned work",
        items: [],
      };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}
