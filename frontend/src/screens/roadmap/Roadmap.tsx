/**
 * Full-width Roadmap as a vertical day list (prototype "Roadmap" tab) with a
 * right-side day-plan panel. Writes stay deliberate: proposed days can be
 * confirmed, locked/unlocked, and adjusted in the existing day drawer.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, Check, Flag, Lock, SlidersHorizontal, Unlock } from "lucide-react";
import type { ReplanProposalDetail, RoadmapDay, RoadmapItem, TimeFixedResolution } from "@api-types";
import type { TimeFixedDecision } from "@/lib/buildApproveEdits";
import { daysApi, replanApi, roadmapApi } from "@/api";
import { Button } from "@/components/ui/button";
import { StatusPill, type StatusKind } from "@/components/StatusPill";
import { Skeleton } from "@/components/Skeleton";
import { cn } from "@/lib/utils";
import { calmMessage } from "@/lib/apiError";
import { dayProgress, isDayComplete } from "@/lib/planningDisplay";
import { DayDrawer } from "./DayDrawer";
import { TimeFixedConflictControl } from "./TimeFixedConflictControl";
import { buildTimeline } from "./timeline";
import { formatDay } from "./dates";

const DAY_PILL: Record<RoadmapDay["status"], StatusKind> = {
  proposed: "proposed",
  confirmed: "confirmed",
  completed: "completed",
  slipped: "slipped",
  projected: "open",
};

const LEGEND: { label: string; kind: StatusKind; projected?: boolean }[] = [
  { label: "Completed", kind: "completed" },
  { label: "Confirmed", kind: "confirmed" },
  { label: "Proposed", kind: "proposed" },
  { label: "Slipped", kind: "slipped" },
];

export function Roadmap() {
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const [openDate, setOpenDate] = useState<string | null>(searchParams.get("date"));
  const [selectedDate, setSelectedDate] = useState<string | null>(searchParams.get("date"));
  const [activeProposalId, setActiveProposalId] = useState<string | null>(searchParams.get("proposal"));
  const [keepTodayMode, setKeepTodayMode] = useState(false);
  const [keepTodayTaskIds, setKeepTodayTaskIds] = useState<Set<string>>(new Set());

  const roadmap = useQuery({ queryKey: ["roadmap", "all"], queryFn: () => roadmapApi.get() });
  const pending = useQuery({ queryKey: ["replan-proposals", "pending"], queryFn: () => replanApi.list("pending") });
  const pendingProposal = pending.data?.[0] ?? null;
  const proposalId = activeProposalId ?? pendingProposal?.id ?? null;
  const proposalDetail = useQuery({
    queryKey: ["replan-proposal", proposalId],
    queryFn: () => replanApi.get(proposalId as string),
    enabled: proposalId != null,
  });
  const activeProposal =
    proposalDetail.data?.proposal.status === "pending" ? proposalDetail.data : null;
  const displayRoadmap = activeProposal?.preview?.roadmap ?? roadmap.data;

  const timeline = useMemo(() => (displayRoadmap ? buildTimeline(displayRoadmap) : null), [displayRoadmap]);
  const today = displayRoadmap?.position.today ?? roadmap.data?.position.today ?? null;
  const daysAhead = displayRoadmap?.days.filter((day) => (today ? day.date >= today : true)).length ?? 0;
  const selectedDay =
    displayRoadmap?.days.find((day) => day.date === selectedDate) ??
    displayRoadmap?.days.find((day) => day.date === activeProposal?.preview?.next_pending_date) ??
    displayRoadmap?.days.find((day) => day.date === today) ??
    displayRoadmap?.days[0] ??
    null;

  useEffect(() => {
    if (!selectedDate && selectedDay) setSelectedDate(selectedDay.date);
  }, [selectedDate, selectedDay]);

  useEffect(() => {
    if (pendingProposal && !activeProposalId) setActiveProposalId(pendingProposal.id);
  }, [activeProposalId, pendingProposal]);

  useEffect(() => {
    if (
      activeProposalId &&
      proposalDetail.data?.proposal.id === activeProposalId &&
      proposalDetail.data.proposal.status !== "pending"
    ) {
      setActiveProposalId(null);
    }
  }, [activeProposalId, proposalDetail.data?.proposal.id, proposalDetail.data?.proposal.status]);

  useEffect(() => {
    const next = activeProposal?.preview?.next_pending_date;
    if (next) setSelectedDate(next);
  }, [activeProposal?.proposal.id, activeProposal?.preview?.next_pending_date]);

  const proposeMore = useMutation({
    mutationFn: () => roadmapApi.propose({ horizon_days: 14 }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["roadmap"] });
      void qc.invalidateQueries({ queryKey: ["morning-brief"] });
    },
  });

  const requestReplan = useMutation({
    mutationFn: (keepTaskIds: string[]) =>
      replanApi.create(undefined, { keep_today_task_ids: keepTaskIds }),
    onSuccess: (proposal) => {
      void qc.invalidateQueries({ queryKey: ["replan-proposals"] });
      void qc.invalidateQueries({ queryKey: ["morning-brief"] });
      setActiveProposalId(proposal.id);
      setKeepTodayMode(false);
      if (today) setSelectedDate(today);
    },
  });

  const approveDay = useMutation({
    mutationFn: (input: { proposalId: string; date: string; time_fixed_resolutions: TimeFixedResolution[] }) =>
      replanApi.approveDay(input.proposalId, input.date, {
        time_fixed_resolutions: input.time_fixed_resolutions,
      }),
    onSuccess: (detail) => {
      seedReviewResult(qc, detail);
      invalidateRoadmapReview(qc);
      if (detail.proposal.status === "pending") {
        setActiveProposalId(detail.proposal.id);
        setSelectedDate(detail.preview?.next_pending_date ?? detail.proposal.created_at.slice(0, 10));
      } else {
        setActiveProposalId(null);
        if (today) setSelectedDate(today);
      }
    },
  });

  const rejectDay = useMutation({
    mutationFn: (input: { proposalId: string; date: string }) =>
      replanApi.rejectDay(input.proposalId, input.date),
    onSuccess: (detail) => {
      seedReviewResult(qc, detail);
      invalidateRoadmapReview(qc);
      if (detail.proposal.status === "pending") {
        setActiveProposalId(detail.proposal.id);
        setSelectedDate(detail.preview?.next_pending_date ?? detail.proposal.created_at.slice(0, 10));
      } else {
        setActiveProposalId(null);
        if (today) setSelectedDate(today);
      }
    },
  });

  const dismissReplan = useMutation({
    mutationFn: (proposalId: string) => replanApi.reject(proposalId),
    onSuccess: () => {
      invalidateRoadmapReview(qc);
      setActiveProposalId(null);
      if (today) setSelectedDate(today);
    },
  });

  const todayIncompleteItems = useMemo(() => {
    const day = roadmap.data?.days.find((entry) => entry.date === roadmap.data?.position.today);
    return (day?.items ?? []).filter((item) => item.status !== "completed" && item.task?.status !== "done");
  }, [roadmap.data]);

  function beginReplan() {
    if (todayIncompleteItems.length > 0) {
      setKeepTodayTaskIds(new Set(todayIncompleteItems.map((item) => item.task_id)));
      setKeepTodayMode(true);
      if (roadmap.data?.position.today) setSelectedDate(roadmap.data.position.today);
      return;
    }
    requestReplan.mutate([]);
  }

  if (roadmap.isLoading || (proposalId != null && proposalDetail.isLoading && !displayRoadmap)) {
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
      <header className="flex flex-none flex-wrap items-center gap-3 border-b border-border bg-bg px-6 py-4">
        <h2 className="text-2xl font-black tracking-tight">Roadmap</h2>
        <span className="text-xs font-bold text-text-tertiary">{daysAhead} days ahead</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={beginReplan}
            disabled={requestReplan.isPending || proposalId != null}
          >
            <SlidersHorizontal size={14} />
            {proposalId ? "Reviewing replan" : requestReplan.isPending ? "Replanning…" : "Replan"}
          </Button>
          <Button size="sm" onClick={() => proposeMore.mutate()} disabled={proposeMore.isPending}>
            <CalendarDays size={14} />
            {proposeMore.isPending ? "Proposing…" : "Propose more days"}
          </Button>
        </div>
      </header>

      <div className="flex flex-none flex-wrap items-center gap-3 border-b border-border px-6 py-2.5">
        {LEGEND.map((item) => (
          <span key={item.label} className="inline-flex items-center gap-1.5 text-[10px] font-bold text-text-secondary">
            <StatusPill status={item.kind} label={item.label} />
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-system">
          <Flag size={11} /> Milestone
        </span>
      </div>

      {timeline.entries.length === 0 ? (
        <div className="p-6">
          <h3 className="text-lg font-black">No days yet</h3>
          <p className="mt-2 text-sm font-semibold text-text-tertiary">
            Finish onboarding or propose more days to build the path.
          </p>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="min-w-0 overflow-auto px-6 py-5">
            <div className="relative flex flex-col gap-3 pl-1">
              <div className="absolute bottom-4 left-[15px] top-4 w-0.5 bg-border" />
              {timeline.entries.map((entry) =>
                entry.kind === "day" ? (
                  <DayRow
                    key={`day-${entry.date}`}
                    day={entry.day}
                    today={today}
                    selected={entry.date === selectedDay?.date}
                    onSelect={() => setSelectedDate(entry.date)}
                  />
                ) : (
                  <MilestoneRow
                    key={`ms-${entry.id}-${entry.date}`}
                    date={entry.date}
                    title={entry.title}
                    achieved={entry.achieved}
                  />
                ),
              )}
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
            keepTodayMode={keepTodayMode}
            keepTodayItems={todayIncompleteItems}
            keepTodayTaskIds={keepTodayTaskIds}
            onToggleKeepToday={(taskId) =>
              setKeepTodayTaskIds((prev) => {
                const next = new Set(prev);
                if (next.has(taskId)) next.delete(taskId);
                else next.add(taskId);
                return next;
              })
            }
            onCancelKeepToday={() => setKeepTodayMode(false)}
            onStartReplan={() => requestReplan.mutate([...keepTodayTaskIds])}
            startingReplan={requestReplan.isPending}
            replanDetail={activeProposal}
            reviewingBusy={approveDay.isPending || rejectDay.isPending || dismissReplan.isPending}
            reviewingError={
              approveDay.error || rejectDay.error || dismissReplan.error
                ? calmMessage(approveDay.error ?? rejectDay.error ?? dismissReplan.error)
                : null
            }
            onApproveReplanDay={(date, timeFixedResolutions) => {
              if (!activeProposal) return;
              approveDay.mutate({
                proposalId: activeProposal.proposal.id,
                date,
                time_fixed_resolutions: timeFixedResolutions,
              });
            }}
            onRejectReplanDay={(date) => {
              if (!activeProposal) return;
              rejectDay.mutate({ proposalId: activeProposal.proposal.id, date });
            }}
            onDismissReplan={() => {
              if (!activeProposal) return;
              dismissReplan.mutate(activeProposal.proposal.id);
            }}
            onOpenDrawer={(date) => setOpenDate(date)}
            onRefresh={() => {
              void qc.invalidateQueries({ queryKey: ["roadmap"] });
              void qc.invalidateQueries({ queryKey: ["morning-brief"] });
            }}
          />
        </div>
      )}

      <DayDrawer date={openDate} onClose={() => setOpenDate(null)} today={today} />
    </div>
  );
}

/**
 * Write the day-review response into the caches the screen reads BEFORE invalidating,
 * so the approved/rejected arrangement shows immediately and the background refetch
 * (now reflecting the persisted plan) reconciles without flipping back to the old plan.
 */
function seedReviewResult(qc: ReturnType<typeof useQueryClient>, detail: ReplanProposalDetail) {
  qc.setQueryData(["replan-proposal", detail.proposal.id], detail);
  if (detail.preview?.roadmap) qc.setQueryData(["roadmap", "all"], detail.preview.roadmap);
}

function invalidateRoadmapReview(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["roadmap"] });
  void qc.invalidateQueries({ queryKey: ["replan-proposals"] });
  void qc.invalidateQueries({ queryKey: ["replan-proposal"] });
  void qc.invalidateQueries({ queryKey: ["morning-brief"] });
  void qc.invalidateQueries({ queryKey: ["day"] });
}

function DayRow({
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
  const { done, total } = dayProgress(day);
  const complete = isDayComplete(day);
  const summary = day.items
    .slice(0, 3)
    .map((item) => item.task?.title)
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="relative flex items-center gap-4">
      <span
        className={cn(
          "z-10 grid flex-none place-items-center rounded-full font-mono text-[9px] font-bold",
          isToday
            ? "h-8 w-8 border-[3px] border-progress bg-bg text-progress shadow-[0_0_0_4px_var(--accent-progress-soft)]"
            : complete
              ? "h-7 w-7 border-2 border-progress bg-progress-soft text-progress"
              : cn(
                  "h-7 w-7 border-2 border-border-strong bg-surface-1 text-text-tertiary",
                  day.projected && "border-dashed",
                ),
        )}
      >
        {isToday ? (total ? `${done}/${total}` : "•") : complete ? <Check size={13} /> : total || ""}
      </span>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex flex-1 items-center gap-3 rounded-[13px] border px-4 py-3 text-left transition-colors",
          selected
            ? "border-progress bg-progress-soft"
            : isToday
              ? "border-progress/60 bg-bg hover:bg-surface-2"
              : "border-border bg-bg hover:bg-surface-2",
          day.projected && !selected && "border-dashed",
        )}
      >
        <div className="min-w-0">
          {isToday && (
            <p className="text-[9px] font-black uppercase tracking-[0.12em] text-progress">You are here</p>
          )}
          <p className="text-sm font-black text-text-primary">
            <span className="text-text-tertiary">{weekday}</span> {rest}
          </p>
          {summary && <p className="mt-0.5 truncate text-xs font-semibold text-text-secondary">{summary}</p>}
        </div>
        <span className="ml-auto flex flex-none items-center gap-2">
          <span className="text-[11px] font-bold text-text-tertiary">
            {total} task{total === 1 ? "" : "s"}
          </span>
          <StatusPill status={DAY_PILL[day.status]} label={day.projected ? "Projected" : undefined} />
        </span>
      </button>
    </div>
  );
}

function MilestoneRow({ date, title, achieved }: { date: string; title: string; achieved: boolean }) {
  const { rest } = formatDay(date);
  return (
    <div className="relative flex items-center gap-4">
      <span
        className={cn(
          "z-10 grid h-7 w-7 flex-none rotate-45 place-items-center rounded-[8px] border-2",
          achieved ? "border-progress bg-progress-soft" : "border-system bg-system-soft",
        )}
      >
        <Flag size={12} className={cn("-rotate-45", achieved ? "text-progress" : "text-system")} />
      </span>
      <div
        className={cn(
          "flex flex-1 items-center gap-2 rounded-[13px] border px-4 py-3",
          achieved ? "border-progress/50 bg-progress-soft" : "border-system/50 bg-system-soft",
        )}
      >
        <span className={cn("text-sm font-black", achieved ? "text-progress" : "text-system")}>
          🚩 Milestone — “{title}”
        </span>
        <span className={cn("ml-auto font-mono text-[11px] font-bold", achieved ? "text-progress" : "text-system")}>
          {achieved ? rest : `~${rest}`}
        </span>
      </div>
    </div>
  );
}

function DayContextPanel({
  day,
  today,
  keepTodayMode,
  keepTodayItems,
  keepTodayTaskIds,
  onToggleKeepToday,
  onCancelKeepToday,
  onStartReplan,
  startingReplan,
  replanDetail,
  reviewingBusy,
  reviewingError,
  onApproveReplanDay,
  onRejectReplanDay,
  onDismissReplan,
  onOpenDrawer,
  onRefresh,
}: {
  day: RoadmapDay | null;
  today: string | null;
  keepTodayMode: boolean;
  keepTodayItems: RoadmapItem[];
  keepTodayTaskIds: Set<string>;
  onToggleKeepToday: (taskId: string) => void;
  onCancelKeepToday: () => void;
  onStartReplan: () => void;
  startingReplan: boolean;
  replanDetail: ReplanProposalDetail | null;
  reviewingBusy: boolean;
  reviewingError: string | null;
  onApproveReplanDay: (date: string, timeFixedResolutions: TimeFixedResolution[]) => void;
  onRejectReplanDay: (date: string) => void;
  onDismissReplan: () => void;
  onOpenDrawer: (date: string) => void;
  onRefresh: () => void;
}) {
  const [timeFixedDecisions, setTimeFixedDecisions] = useState<Record<string, TimeFixedDecision | undefined>>({});
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: onRefresh,
  });
  useEffect(() => {
    setTimeFixedDecisions({});
  }, [day?.date, replanDetail?.proposal.id]);

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
  const reviewDates = replanDetail?.preview?.changed_dates ?? [];
  const reviewDecision = replanDetail?.preview?.day_decisions.find((decision) => decision.date === day.date);
  const isReviewDate = reviewDates.includes(day.date);
  const conflictsForDay =
    replanDetail?.changes.time_fixed_conflicts.filter((conflict) => conflict.fixed_date === day.date) ?? [];
  const everyConflictResolved = conflictsForDay.every((conflict) => timeFixedDecisions[conflict.task_id]);
  const timeFixedResolutions = conflictsForDay
    .map((conflict): TimeFixedResolution | null => {
      const decision = timeFixedDecisions[conflict.task_id];
      if (!decision) return null;
      return decision.choice === "renegotiate"
        ? { task_id: conflict.task_id, choice: "renegotiate", new_fixed_date: decision.new_fixed_date }
        : { task_id: conflict.task_id, choice: decision.choice };
    })
    .filter((resolution): resolution is TimeFixedResolution => resolution != null);

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

      {keepTodayMode ? (
        <KeepTodayPanel
          items={keepTodayItems}
          selectedIds={keepTodayTaskIds}
          starting={startingReplan}
          onToggle={onToggleKeepToday}
          onCancel={onCancelKeepToday}
          onStart={onStartReplan}
        />
      ) : replanDetail ? (
        <div className="mb-5 rounded-[12px] border border-system/40 bg-system-soft px-3 py-3">
          <div className="mb-3 flex items-center gap-2">
            <SlidersHorizontal size={14} className="text-system" />
            <p className="text-xs font-black uppercase tracking-wider text-system">Replan review</p>
            {reviewDecision && (
              <span className="ml-auto text-[11px] font-black capitalize text-system">{reviewDecision.status}</span>
            )}
          </div>
          {replanDetail.preview?.today_capacity?.date === day.date && (
            <p className="mb-3 text-[11px] font-semibold text-text-secondary">
              Today has {replanDetail.preview.today_capacity.remaining_hours.toFixed(1)}h available after completed work.
            </p>
          )}
          {conflictsForDay.length > 0 && (
            <div className="mb-3 space-y-2">
              {conflictsForDay.map((conflict) => (
                <TimeFixedConflictControl
                  key={conflict.task_id}
                  conflict={conflict}
                  onChange={(decision) =>
                    setTimeFixedDecisions((prev) => ({ ...prev, [conflict.task_id]: decision }))
                  }
                />
              ))}
            </div>
          )}
          {reviewingError && <p className="mb-2 text-xs font-bold text-warning">{reviewingError}</p>}
          {reviewDates.length === 0 ? (
            <Button size="sm" className="w-full" variant="outline" disabled={reviewingBusy} onClick={onDismissReplan}>
              Dismiss
            </Button>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                disabled={!isReviewDate || !!reviewDecision || reviewingBusy || !everyConflictResolved}
                onClick={() => onApproveReplanDay(day.date, timeFixedResolutions)}
              >
                Approve day
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!isReviewDate || !!reviewDecision || reviewingBusy}
                onClick={() => onRejectReplanDay(day.date)}
              >
                Reject day
              </Button>
            </div>
          )}
        </div>
      ) : (
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
      )}

      {day.projected && !replanDetail && (
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
                  {item.status === "completed" ? "Completed" : "Planned"} · {taskHoursLabel(item)}
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

function KeepTodayPanel({
  items,
  selectedIds,
  starting,
  onToggle,
  onCancel,
  onStart,
}: {
  items: RoadmapItem[];
  selectedIds: Set<string>;
  starting: boolean;
  onToggle: (taskId: string) => void;
  onCancel: () => void;
  onStart: () => void;
}) {
  return (
    <div className="mb-5 rounded-[12px] border border-system/40 bg-system-soft px-3 py-3">
      <div className="mb-3 flex items-center gap-2">
        <SlidersHorizontal size={14} className="text-system" />
        <p className="text-xs font-black uppercase tracking-wider text-system">Keep on today</p>
      </div>
      <div className="space-y-1.5">
        {items.map((item) => (
          <label
            key={item.task_id}
            className="flex items-start gap-2 rounded-md border border-border bg-bg px-3 py-2"
          >
            <input
              type="checkbox"
              checked={selectedIds.has(item.task_id)}
              onChange={() => onToggle(item.task_id)}
              className="mt-0.5 h-4 w-4 flex-none accent-[var(--accent-progress)]"
            />
            <span className="min-w-0">
              <span className="block truncate text-xs font-extrabold text-text-primary">
                {item.task?.title ?? "Task"}
              </span>
              <span className="block text-[11px] font-semibold text-text-tertiary">{taskHoursLabel(item)}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" onClick={onCancel} disabled={starting}>
          Cancel
        </Button>
        <Button size="sm" onClick={onStart} disabled={starting}>
          {starting ? "Replanning…" : "Start replan"}
        </Button>
      </div>
    </div>
  );
}

function taskHoursLabel(item: RoadmapItem): string {
  if (item.task?.estimate_hours) return `${Number(item.task.estimate_hours).toFixed(1)}h`;
  return "1.5h assumed";
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
