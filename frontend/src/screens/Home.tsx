/**
 * Home / Dashboard (web-screens §B) — today front and centre. Live from
 * GET /morning-brief: today's Daily Goals with working check-off (POST
 * /tasks/{id}/complete · /reopen), the streak/points summary, the nearest
 * milestone, and a pending-proposal nudge. Goal progress cards use GET
 * /goals + GET /goals/{id}?include=progress.
 *
 * This screen is the F1 proof: if it renders real data from the DEPLOYED /v1
 * cross-origin, the two-separate-deployables architecture works.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { goalsApi, morningBriefApi, tasksApi } from "@/api";
import type { GoalWithProgress, MorningBrief, RoadmapTaskRef } from "@api-types";
import { useNavigate } from "react-router-dom";
import { StatusPill, type StatusKind } from "@/components/StatusPill";
import { useCelebration } from "@/components/Celebration";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";
import { Button } from "@/components/ui/button";
import { calmMessage } from "@/lib/apiError";
import { cn } from "@/lib/utils";

function taskStatusToPill(task: RoadmapTaskRef | null): StatusKind {
  if (!task) return "open";
  return task.status === "done" ? "done" : "open";
}

export function Home() {
  const qc = useQueryClient();
  const { celebrate } = useCelebration();
  const brief = useQuery({ queryKey: ["morning-brief"], queryFn: morningBriefApi.get });

  const toggle = useMutation({
    mutationFn: async ({ taskId, completed }: { taskId: string; completed: boolean }) => {
      if (completed) {
        await tasksApi.reopen(taskId);
        return null;
      }
      return tasksApi.complete(taskId);
    },
    onSuccess: (result) => {
      // A completion/reopen touches today's plan, the path, and goal progress.
      for (const key of [["morning-brief"], ["roadmap"], ["goal"]]) {
        void qc.invalidateQueries({ queryKey: key });
      }
      // Fires once: `milestone_achieved` is present only on the completion that
      // crosses the milestone (backend sets achieved_at once). See Celebration.tsx.
      if (result?.milestone_achieved) {
        celebrate({
          milestoneId: result.milestone_achieved.milestone_id,
          title: result.milestone_achieved.title,
          bonusPoints: result.milestone_achieved.points_awarded,
        });
      }
    },
  });

  if (brief.isLoading) {
    return (
      <div className="grid grid-cols-1 items-start gap-5 p-6 lg:grid-cols-[1.15fr_1fr]">
        <section className="flex flex-col gap-4 rounded-[18px] border border-border bg-surface-1 p-5">
          <Skeleton className="h-8 w-48" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </section>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      </div>
    );
  }
  if (brief.isError || !brief.data) {
    return <p className="p-6 text-sm font-bold text-warning">{calmMessage(brief.error)}</p>;
  }

  const data: MorningBrief = brief.data;
  const items = data.today?.items ?? [];
  const done = items.filter((i) => i.item.status === "completed").length;

  return (
    <div className="grid grid-cols-1 items-start gap-5 p-6 lg:grid-cols-[1.15fr_1fr]">
      {/* LEFT — today focus */}
      <section className="flex flex-col gap-4 rounded-[18px] border border-border bg-surface-1 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-text-tertiary">
              Today’s daily goal
            </span>
            <span className="text-2xl font-black tracking-tight">{data.position.today}</span>
          </div>
          <div className="ml-auto flex items-center gap-5">
            <Metric value={`${done}/${items.length || 0}`} label="tasks" accent />
            <Metric value={String(data.stats.total_points)} label="points" accent />
            <Metric value={String(data.stats.current_streak)} label="streak 🔥" />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {items.length === 0 && (
            <p className="rounded-[12px] border border-dashed border-border px-4 py-6 text-center text-sm font-semibold text-text-tertiary">
              No tasks planned for today yet. Build your roadmap to fill it in.
            </p>
          )}
          {items.map((entry) => {
            const taskId = entry.item.task_id;
            const completed = entry.item.status === "completed";
            return (
              <button
                key={entry.item.id}
                disabled={!taskId || toggle.isPending}
                onClick={() =>
                  taskId && toggle.mutate({ taskId, completed })
                }
                className={cn(
                  "flex items-center gap-3 rounded-[12px] border px-4 py-3 text-left transition-colors",
                  completed
                    ? "border-progress/40 bg-progress-soft"
                    : "border-border bg-bg hover:bg-surface-2",
                )}
              >
                <span
                  className={cn(
                    "flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[7px] text-[13px] font-extrabold",
                    completed
                      ? "bg-progress text-on-accent [animation:pop_200ms_ease-out]"
                      : "border-2 border-border-strong",
                  )}
                >
                  {completed ? "✓" : ""}
                </span>
                <span
                  className={cn(
                    "flex-1 text-sm font-bold",
                    completed ? "text-progress line-through" : "text-text-primary",
                  )}
                >
                  {entry.task?.title ?? "Task"}
                </span>
                <StatusPill status={completed ? "done" : taskStatusToPill(entry.task)} />
              </button>
            );
          })}
        </div>
      </section>

      {/* RIGHT — quieter column */}
      <div className="flex min-w-0 flex-col gap-4">
        {data.pending_proposal && (
          <section className="flex flex-col gap-3 rounded-[16px] border border-system/40 bg-system-soft p-4">
            <span className="text-sm font-extrabold text-text-primary">A replan is proposed</span>
            <span className="text-xs font-semibold leading-relaxed text-system">
              {data.pending_proposal.summary}
            </span>
          </section>
        )}

        {data.next_milestone && (
          <section className="flex items-center gap-3 rounded-[16px] border border-border bg-surface-1 p-4">
            <span className="text-lg">🚩</span>
            <div className="flex flex-col">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-system">
                Next landmark
              </span>
              <span className="text-sm font-extrabold">
                {data.next_milestone.title} · in {data.next_milestone.days_away} days
              </span>
            </div>
          </section>
        )}

        <GoalsOverview />
      </div>
    </div>
  );
}

function Metric({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="flex flex-col items-end">
      <span className={cn("font-mono text-base font-bold", accent ? "text-progress" : "text-text-primary")}>
        {value}
      </span>
      <span className="text-[10px] font-bold text-text-tertiary">{label}</span>
    </div>
  );
}

function GoalsOverview() {
  const navigate = useNavigate();
  const goals = useQuery({ queryKey: ["goals"], queryFn: goalsApi.list });
  return (
    <section className="flex flex-col gap-3">
      <span className="text-sm font-black">Goals &amp; progress</span>
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
        goals.data.map((g) => (
          <GoalCard key={g.id} goalId={g.id} title={g.title} horizon={g.horizon} />
        ))
      )}
    </section>
  );
}

function GoalCard({
  goalId,
  title,
  horizon,
}: {
  goalId: string;
  title: string;
  horizon: string;
}) {
  const q = useQuery({
    queryKey: ["goal", goalId, "progress"],
    queryFn: () => goalsApi.get(goalId, true) as Promise<GoalWithProgress>,
  });
  const pct = q.data?.progress.percent_done ?? 0;
  return (
    <div className="flex flex-col gap-2.5 rounded-[16px] border border-border bg-surface-1 p-4">
      <div className="flex items-center gap-2.5">
        <span className="text-progress">◎</span>
        <span className="text-[15px] font-extrabold">{title}</span>
        <span className="rounded-[5px] bg-surface-2 px-1.5 py-0.5 text-[9px] font-extrabold text-text-secondary">
          {horizon.toUpperCase()}
        </span>
        <span className="ml-auto font-mono text-[13px] font-bold text-progress">{pct}%</span>
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
