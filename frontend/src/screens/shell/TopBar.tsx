/**
 * Prototype Today bar: compact progress summary by default, expandable strip for
 * complete/reopen, defer, quick add, pull-forward, and proposal actions.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CalendarPlus,
  Check,
  ChevronDown,
  Clock3,
  Moon,
  Plus,
  RotateCcw,
  Sparkles,
  Sun,
} from "lucide-react";
import { daysApi, morningBriefApi, planItemsApi, replanApi, roadmapApi, tasksApi } from "@/api";
import { useSession } from "@/auth/session";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { deriveTodayProgress, selectRoadAhead } from "@/lib/planningDisplay";
import { useAddableTasks } from "@/screens/roadmap/useAddableTasks";

export function TopBar() {
  const { signOut } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [theme, toggleTheme] = useTheme();
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  const expanded = pinnedOpen || hoverOpen || quickAddOpen;
  const brief = useQuery({ queryKey: ["morning-brief"], queryFn: morningBriefApi.get });
  const today = brief.data?.position.today;
  const entries = brief.data?.today?.items ?? [];
  const taskIds = entries.map((entry) => entry.item.task_id).filter((id): id is string => id != null);
  const progress = deriveTodayProgress(entries);
  const pending = brief.data?.pending_proposal;
  const stats = brief.data?.stats;

  const roadmap = useQuery({
    queryKey: ["roadmap", "topbar", today],
    queryFn: () => roadmapApi.get(today ? { from: today } : undefined),
    enabled: expanded && Boolean(today),
    staleTime: 30_000,
  });
  const addable = useAddableTasks(expanded && quickAddOpen, taskIds);

  const invalidateLive = () => {
    for (const key of [["morning-brief"], ["roadmap"], ["goals"], ["goal"], ["addable-tasks"]]) {
      void qc.invalidateQueries({ queryKey: key });
    }
  };

  const toggleTask = useMutation<unknown, Error, { taskId: string; completed: boolean }>({
    mutationFn: ({ taskId, completed }: { taskId: string; completed: boolean }) =>
      completed ? tasksApi.reopen(taskId) : tasksApi.complete(taskId),
    onSuccess: invalidateLive,
  });
  const deferItem = useMutation({
    mutationFn: (itemId: string) => planItemsApi.patch(itemId, { status: "deferred" }),
    onSuccess: invalidateLive,
  });
  const addItem = useMutation({
    mutationFn: (taskId: string) => {
      if (!today) throw new Error("No day is available");
      return daysApi.addItem(today, taskId);
    },
    onSuccess: () => {
      setQuickAddOpen(false);
      invalidateLive();
    },
  });
  const pullForward = useMutation({
    mutationFn: (taskId: string) => tasksApi.pullForward(taskId, today),
    onSuccess: invalidateLive,
  });
  const approveProposal = useMutation({
    mutationFn: (proposalId: string) => replanApi.approve(proposalId),
    onSuccess: invalidateLive,
  });

  const futureCandidates = selectRoadAhead(roadmap.data, today ?? "", 10)
    .filter((day) => day.date !== today)
    .flatMap((day) =>
      day.items
        .filter((item) => item.task && item.task.status === "todo" && !item.task.blocked)
        .map((item) => ({ date: day.date, task: item.task! })),
    )
    .slice(0, 3);

  return (
    <header
      ref={headerRef}
      onMouseEnter={() => setHoverOpen(true)}
      onMouseLeave={() => setHoverOpen(false)}
      onFocus={() => setHoverOpen(true)}
      onBlur={(event) => {
        if (!headerRef.current?.contains(event.relatedTarget as Node | null)) {
          setHoverOpen(false);
          setQuickAddOpen(false);
        }
      }}
      className={cn(
        "relative z-30 flex flex-none flex-col border-b border-border bg-bg/95 px-4 backdrop-blur transition-[height]",
        expanded ? "h-[214px]" : "h-[66px]",
      )}
    >
      <div className="flex h-[66px] flex-none items-center gap-4">
        <button
          type="button"
          onClick={() => setPinnedOpen((open) => !open)}
          aria-expanded={expanded}
          className="group flex min-w-0 flex-1 items-center gap-3 rounded-[10px] px-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        >
          <ProgressRing done={progress.done} total={progress.total} percent={progress.percent} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-black uppercase tracking-[0.16em] text-text-tertiary">
                Today
              </span>
              {pending && (
                <span className="inline-flex items-center gap-1 rounded-full bg-system-soft px-2 py-0.5 text-[10px] font-black text-system">
                  <span className="h-1.5 w-1.5 rounded-full bg-system [animation:pulse-soft_2.5s_ease-in-out_infinite]" />
                  Proposal
                </span>
              )}
            </div>
            <p className="truncate text-sm font-extrabold text-text-primary">
              {progress.current?.title ?? (progress.total ? "All tasks complete" : "No tasks planned")}
            </p>
          </div>
          <ChevronDown
            size={16}
            className={cn("ml-auto flex-none text-text-tertiary transition-transform", expanded && "rotate-180")}
          />
        </button>

        <div className="hidden items-center gap-5 md:flex">
          <TopMetric label="streak" value={String(stats?.current_streak ?? 0)} />
          <TopMetric label="points" value={String(stats?.total_points ?? 0)} accent />
        </div>

        <button
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          className="flex h-9 w-9 flex-none items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-surface-2 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <Button variant="ghost" size="sm" onClick={() => void signOut()} className="hidden sm:inline-flex">
          Sign out
        </Button>
      </div>

      {expanded && (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 pb-4 md:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 overflow-x-auto rounded-[12px] border border-border bg-surface-1 p-3">
            <div className="flex min-w-max items-center gap-2">
              {entries.length === 0 && (
                <span className="px-2 text-xs font-bold text-text-tertiary">
                  Confirm roadmap days to fill today.
                </span>
              )}
              {entries.map((entry) => {
                const completed = entry.item.status === "completed";
                const taskId = entry.item.task_id;
                return (
                  <div
                    key={entry.item.id}
                    className={cn(
                      "flex h-[46px] max-w-[280px] items-center gap-2 rounded-[10px] border px-2.5",
                      completed ? "border-progress/40 bg-progress-soft" : "border-border bg-bg",
                    )}
                  >
                    <button
                      type="button"
                      disabled={!taskId || toggleTask.isPending}
                      onClick={() => taskId && toggleTask.mutate({ taskId, completed })}
                      className={cn(
                        "flex h-7 w-7 flex-none items-center justify-center rounded-[8px] border text-xs font-black",
                        completed
                          ? "border-progress bg-progress text-on-accent"
                          : "border-border-strong text-text-tertiary hover:text-progress",
                      )}
                      title={completed ? "Reopen task" : "Complete task"}
                    >
                      {completed ? <RotateCcw size={14} /> : <Check size={15} />}
                    </button>
                    <span className={cn("truncate text-xs font-extrabold", completed && "text-progress line-through")}>
                      {entry.task?.title ?? "Task"}
                    </span>
                    <button
                      type="button"
                      disabled={deferItem.isPending || completed}
                      onClick={() => deferItem.mutate(entry.item.id)}
                      className="ml-auto flex h-7 w-7 flex-none items-center justify-center rounded-[8px] text-text-tertiary hover:bg-surface-2 hover:text-warning disabled:opacity-40"
                      title="Defer"
                    >
                      <Clock3 size={14} />
                    </button>
                  </div>
                );
              })}

              <div className="relative">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setQuickAddOpen((open) => !open)}
                  disabled={!today}
                >
                  <Plus size={14} />
                  Quick add
                </Button>
                {quickAddOpen && (
                  <div className="absolute left-0 top-11 z-40 w-[280px] rounded-[12px] border border-border bg-bg p-2 shadow-xl">
                    {addable.isLoading && (
                      <p className="px-2 py-2 text-xs font-bold text-text-tertiary">Loading tasks...</p>
                    )}
                    {addable.data?.slice(0, 6).map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => addItem.mutate(task.id)}
                        className="flex w-full items-center gap-2 rounded-[8px] px-2 py-2 text-left text-xs font-extrabold text-text-secondary hover:bg-surface-2 hover:text-text-primary"
                      >
                        <CalendarPlus size={14} className="text-progress" />
                        <span className="truncate">{task.title}</span>
                      </button>
                    ))}
                    {addable.data?.length === 0 && (
                      <p className="px-2 py-2 text-xs font-bold text-text-tertiary">No open tasks available.</p>
                    )}
                  </div>
                )}
              </div>

              <Button type="button" size="sm" variant="ghost" onClick={() => navigate("/roadmap")}>
                Open full day
                <ArrowRight size={14} />
              </Button>
            </div>
          </div>

          <div className="grid min-h-0 grid-rows-[auto_1fr] gap-2">
            {pending ? (
              <div className="flex items-center gap-2 rounded-[12px] border border-system/40 bg-system-soft px-3 py-2">
                <Sparkles size={16} className="text-system" />
                <span className="min-w-0 flex-1 truncate text-xs font-extrabold text-system">
                  {pending.summary}
                </span>
                <Button
                  size="sm"
                  variant="system"
                  onClick={() => approveProposal.mutate(pending.id)}
                  disabled={approveProposal.isPending}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigate(`/roadmap?proposal=${pending.id}`)}
                >
                  Review
                </Button>
              </div>
            ) : (
              <div className="rounded-[12px] border border-border bg-surface-1 px-3 py-2 text-xs font-bold text-text-tertiary">
                No pending proposal
              </div>
            )}

            <div className="flex min-h-0 gap-2 overflow-x-auto rounded-[12px] border border-border bg-surface-1 p-2">
              {futureCandidates.length === 0 && (
                <span className="px-1 py-1 text-xs font-bold text-text-tertiary">No pull-forward candidates.</span>
              )}
              {futureCandidates.map(({ date, task }) => (
                <button
                  key={`${date}:${task.id}`}
                  type="button"
                  disabled={pullForward.isPending}
                  onClick={() => pullForward.mutate(task.id)}
                  className="flex min-w-[150px] flex-col rounded-[9px] border border-border bg-bg px-2.5 py-2 text-left hover:border-progress/60"
                >
                  <span className="text-[10px] font-black uppercase tracking-wider text-text-tertiary">
                    Pull forward
                  </span>
                  <span className="truncate text-xs font-extrabold text-text-primary">{task.title}</span>
                  <span className="text-[10px] font-bold text-system">{date}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

function ProgressRing({ done, total, percent }: { done: number; total: number; percent: number }) {
  return (
    <span
      className="grid h-10 w-10 flex-none place-items-center rounded-full"
      style={{
        background: `conic-gradient(var(--accent-progress) ${percent * 3.6}deg, var(--surface-3) 0deg)`,
      }}
    >
      <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-bg font-mono text-[10px] font-black text-progress">
        {total ? `${done}/${total}` : "-"}
      </span>
    </span>
  );
}

function TopMetric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col items-end">
      <span className={cn("font-mono text-sm font-black", accent ? "text-progress" : "text-text-primary")}>
        {value}
      </span>
      <span className="text-[10px] font-black uppercase tracking-wider text-text-tertiary">{label}</span>
    </div>
  );
}
