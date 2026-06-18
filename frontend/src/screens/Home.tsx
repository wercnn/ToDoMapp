/**
 * Home dashboard in the prototype shape: grouped daily work, road-ahead path,
 * goal progress, and an attention card for pending replans / next landmark.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CalendarClock, Check, Clock3, Flag, RotateCcw, Sparkles } from "lucide-react";
import type { GoalWithProgress, MorningBrief, RoadmapTaskRef } from "@api-types";
import { goalsApi, morningBriefApi, planItemsApi, replanApi, roadmapApi, tasksApi } from "@/api";
import { StatusPill, type StatusKind } from "@/components/StatusPill";
import { useCelebration } from "@/components/Celebration";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";
import { Button } from "@/components/ui/button";
import { calmMessage } from "@/lib/apiError";
import { cn } from "@/lib/utils";
import { deriveTodayProgress, groupDayItems, selectRoadAhead } from "@/lib/planningDisplay";

function taskStatusToPill(task: RoadmapTaskRef | null): StatusKind {
  if (!task) return "open";
  if (task.blocked) return "blocked";
  return task.status === "done" ? "done" : "open";
}

export function Home() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { celebrate } = useCelebration();
  const brief = useQuery({ queryKey: ["morning-brief"], queryFn: morningBriefApi.get });
  const roadmap = useQuery({
    queryKey: ["roadmap", "home", brief.data?.position.today],
    queryFn: () => roadmapApi.get(brief.data ? { from: brief.data.position.today } : undefined),
    enabled: Boolean(brief.data),
    staleTime: 30_000,
  });

  const invalidateLive = () => {
    for (const key of [["morning-brief"], ["roadmap"], ["goal"], ["goals"]]) {
      void qc.invalidateQueries({ queryKey: key });
    }
  };
  const toggle = useMutation({
    mutationFn: async ({ taskId, completed }: { taskId: string; completed: boolean }) => {
      if (completed) {
        await tasksApi.reopen(taskId);
        return null;
      }
      return tasksApi.complete(taskId);
    },
    onSuccess: (result) => {
      invalidateLive();
      if (result?.milestone_achieved) {
        celebrate({
          milestoneId: result.milestone_achieved.milestone_id,
          title: result.milestone_achieved.title,
          bonusPoints: result.milestone_achieved.points_awarded,
        });
      }
    },
  });
  const defer = useMutation({
    mutationFn: (itemId: string) => planItemsApi.patch(itemId, { status: "deferred" }),
    onSuccess: invalidateLive,
  });
  const approveProposal = useMutation({
    mutationFn: (proposalId: string) => replanApi.approve(proposalId),
    onSuccess: invalidateLive,
  });

  if (brief.isLoading) {
    return (
      <div className="grid grid-cols-1 items-start gap-5 p-6 xl:grid-cols-[minmax(0,1.15fr)_430px]">
        <section className="flex flex-col gap-4 rounded-[14px] border border-border bg-surface-1 p-5">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-48 w-full" />
        </section>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }
  if (brief.isError || !brief.data) {
    return <p className="p-6 text-sm font-bold text-warning">{calmMessage(brief.error)}</p>;
  }

  const data: MorningBrief = brief.data;
  const entries = data.today?.items ?? [];
  const progress = deriveTodayProgress(entries);
  const groups = groupDayItems(entries);
  const roadAhead = selectRoadAhead(roadmap.data, data.position.today, 8);

  return (
    <div className="grid grid-cols-1 items-start gap-5 p-6 xl:grid-cols-[minmax(0,1.15fr)_430px]">
      <section className="flex min-w-0 flex-col gap-5">
        <div className="rounded-[14px] border border-border bg-surface-1 p-5">
          <div className="mb-5 flex flex-wrap items-end gap-3">
            <div className="flex flex-col">
              <span className="text-[11px] font-black uppercase tracking-[0.16em] text-text-tertiary">
                Today workload
              </span>
              <h1 className="text-2xl font-black tracking-tight">{data.position.today}</h1>
            </div>
            <div className="ml-auto flex items-center gap-6">
              <Metric value={`${progress.done}/${progress.total}`} label="complete" accent />
              <Metric value={String(data.stats.current_streak)} label="streak" />
              <Metric value={String(data.stats.total_points)} label="points" accent />
            </div>
          </div>

          {groups.length === 0 ? (
            <div className="rounded-[12px] border border-dashed border-border px-4 py-10 text-center">
              <p className="text-sm font-extrabold text-text-primary">No tasks planned today</p>
              <p className="mt-1 text-xs font-semibold text-text-tertiary">
                Confirm roadmap days to turn the projection into a daily plan.
              </p>
              <Button className="mt-4" size="sm" onClick={() => navigate("/roadmap")}>
                Open roadmap
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map((group) => (
                <div key={`${group.projectId}:${group.workPackageId}`} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-progress" />
                    <span className="truncate text-xs font-black uppercase tracking-wider text-text-tertiary">
                      {group.projectTitle}
                    </span>
                    <span className="text-xs font-bold text-text-tertiary">/</span>
                    <span className="truncate text-xs font-extrabold text-text-secondary">
                      {group.workPackageTitle}
                    </span>
                  </div>
                  <div className="grid gap-2">
                    {group.items.map((entry) => (
                      <TaskRow
                        key={entry.item.id}
                        entry={entry}
                        disabled={toggle.isPending || defer.isPending}
                        onToggle={(taskId, completed) => toggle.mutate({ taskId, completed })}
                        onDefer={() => defer.mutate(entry.item.id)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <section className="rounded-[14px] border border-border bg-surface-1 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-sm font-black">Road ahead</span>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => navigate("/roadmap")}>
              Full path
              <ArrowRight size={14} />
            </Button>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {roadAhead.map((day, index) => (
              <button
                key={day.date}
                type="button"
                onClick={() => navigate(`/roadmap?date=${day.date}`)}
                className={cn(
                  "flex min-w-[150px] flex-col rounded-[12px] border px-3 py-3 text-left transition-colors",
                  index === 0 ? "border-progress/50 bg-progress-soft" : "border-border bg-bg hover:bg-surface-2",
                )}
              >
                <span className="text-[10px] font-black uppercase tracking-wider text-text-tertiary">
                  {day.projected ? "Projected" : day.status}
                </span>
                <span className="mt-1 font-mono text-sm font-black text-text-primary">{day.date}</span>
                <span className="mt-2 text-xs font-bold text-text-secondary">{day.items.length} tasks</span>
                <div className="mt-3 flex -space-x-1">
                  {day.items.slice(0, 4).map((item) => (
                    <span
                      key={item.task_id}
                      className={cn(
                        "h-5 w-5 rounded-full border border-bg",
                        item.task?.is_time_fixed ? "bg-warning" : "bg-system",
                      )}
                      title={item.task?.title}
                    />
                  ))}
                </div>
              </button>
            ))}
            {roadAhead.length === 0 && (
              <p className="px-1 py-4 text-sm font-semibold text-text-tertiary">No projected days yet.</p>
            )}
          </div>
        </section>
      </section>

      <aside className="flex min-w-0 flex-col gap-4">
        <AttentionCard
          data={data}
          approving={approveProposal.isPending}
          onApprove={(id) => approveProposal.mutate(id)}
          onReview={(id) => navigate(`/roadmap?proposal=${id}`)}
          onRoadmap={() => navigate("/roadmap")}
        />
        <GoalsOverview />
      </aside>
    </div>
  );
}

function TaskRow({
  entry,
  disabled,
  onToggle,
  onDefer,
}: {
  entry: MorningBrief["today"] extends infer T
    ? T extends { items: infer Items }
      ? Items extends Array<infer Item>
        ? Item
        : never
      : never
    : never;
  disabled: boolean;
  onToggle: (taskId: string, completed: boolean) => void;
  onDefer: () => void;
}) {
  const taskId = entry.item.task_id;
  const task = entry.task;
  const completed = entry.item.status === "completed";
  return (
    <div
      className={cn(
        "grid grid-cols-[32px_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-[12px] border px-3 py-3",
        completed ? "border-progress/40 bg-progress-soft" : "border-border bg-bg",
      )}
    >
      <button
        type="button"
        disabled={!taskId || disabled}
        onClick={() => taskId && onToggle(taskId, completed)}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-[9px] border text-xs font-black",
          completed
            ? "border-progress bg-progress text-on-accent"
            : "border-border-strong text-text-tertiary hover:text-progress",
        )}
        title={completed ? "Reopen task" : "Complete task"}
      >
        {completed ? <RotateCcw size={15} /> : <Check size={16} />}
      </button>
      <div className="min-w-0">
        <p className={cn("truncate text-sm font-extrabold", completed && "text-progress line-through")}>
          {task?.title ?? "Task"}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-bold text-text-tertiary">
          {task?.estimate_hours && <span>{Number(task.estimate_hours).toFixed(1)}h</span>}
          {task?.difficulty && <span>{task.difficulty}</span>}
          {task?.is_time_fixed && (
            <span className="inline-flex items-center gap-1 text-warning">
              <CalendarClock size={12} />
              {task.fixed_date}
            </span>
          )}
        </div>
      </div>
      <StatusPill status={completed ? "done" : taskStatusToPill(task)} />
      <button
        type="button"
        disabled={disabled || completed}
        onClick={onDefer}
        className="flex h-8 w-8 items-center justify-center rounded-[9px] text-text-tertiary hover:bg-surface-2 hover:text-warning disabled:opacity-40"
        title="Defer"
      >
        <Clock3 size={15} />
      </button>
    </div>
  );
}

function AttentionCard({
  data,
  approving,
  onApprove,
  onReview,
  onRoadmap,
}: {
  data: MorningBrief;
  approving: boolean;
  onApprove: (id: string) => void;
  onReview: (id: string) => void;
  onRoadmap: () => void;
}) {
  return (
    <section className="rounded-[14px] border border-border bg-surface-1 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles size={16} className="text-system" />
        <span className="text-sm font-black">Attention</span>
      </div>
      {data.pending_proposal ? (
        <div className="rounded-[12px] border border-system/40 bg-system-soft p-3">
          <p className="text-sm font-extrabold text-text-primary">Roadmap proposal ready</p>
          <p className="mt-1 text-xs font-semibold leading-relaxed text-system">
            {data.pending_proposal.summary}
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant="system"
              disabled={approving}
              onClick={() => onApprove(data.pending_proposal!.id)}
            >
              Approve
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onReview(data.pending_proposal!.id)}>
              Review in Roadmap
            </Button>
          </div>
        </div>
      ) : data.next_milestone ? (
        <div className="rounded-[12px] border border-border bg-bg p-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-[9px] bg-system-soft text-system">
              <Flag size={16} />
            </span>
            <div>
              <p className="text-sm font-extrabold text-text-primary">{data.next_milestone.title}</p>
              <p className="mt-1 text-xs font-semibold text-text-tertiary">
                Projected for {data.next_milestone.projected_date}, {data.next_milestone.days_away} days away.
              </p>
            </div>
          </div>
          <Button className="mt-3" size="sm" variant="outline" onClick={onRoadmap}>
            See what is next
            <ArrowRight size={14} />
          </Button>
        </div>
      ) : (
        <p className="rounded-[12px] border border-border bg-bg p-3 text-xs font-semibold text-text-tertiary">
          Nothing needs review right now.
        </p>
      )}
    </section>
  );
}

function Metric({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="flex flex-col items-end">
      <span className={cn("font-mono text-base font-black", accent ? "text-progress" : "text-text-primary")}>
        {value}
      </span>
      <span className="text-[10px] font-black uppercase tracking-wider text-text-tertiary">{label}</span>
    </div>
  );
}

function GoalsOverview() {
  const navigate = useNavigate();
  const goals = useQuery({ queryKey: ["goals"], queryFn: goalsApi.list });
  return (
    <section className="flex flex-col gap-3 rounded-[14px] border border-border bg-surface-1 p-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-black">Goals &amp; progress</span>
        <Button className="ml-auto" size="sm" variant="ghost" onClick={() => navigate("/onboarding")}>
          Add
        </Button>
      </div>
      {!goals.data?.length ? (
        <EmptyState
          icon={<span className="text-2xl">◎</span>}
          title="No goals yet"
          hint="Set your first goal to start building a roadmap toward it."
          action={
            <Button size="sm" onClick={() => navigate("/onboarding")}>
              Set a goal
            </Button>
          }
        />
      ) : (
        goals.data.map((g) => <GoalCard key={g.id} goalId={g.id} title={g.title} horizon={g.horizon} />)
      )}
    </section>
  );
}

function GoalCard({ goalId, title, horizon }: { goalId: string; title: string; horizon: string }) {
  const q = useQuery({
    queryKey: ["goal", goalId, "progress"],
    queryFn: () => goalsApi.get(goalId, true) as Promise<GoalWithProgress>,
  });
  const pct = q.data?.progress.percent_done ?? 0;
  return (
    <div className="flex flex-col gap-2.5 rounded-[12px] border border-border bg-bg p-3">
      <div className="flex items-center gap-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-progress" />
        <span className="min-w-0 flex-1 truncate text-[14px] font-extrabold">{title}</span>
        <span className="rounded-[5px] bg-surface-2 px-1.5 py-0.5 text-[9px] font-black text-text-secondary">
          {horizon.toUpperCase()}
        </span>
        <span className="font-mono text-[13px] font-black text-progress">{pct}%</span>
      </div>
      <span className="h-2 overflow-hidden rounded-full bg-surface-2">
        <span
          className="block h-full rounded-full bg-progress transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </span>
    </div>
  );
}
