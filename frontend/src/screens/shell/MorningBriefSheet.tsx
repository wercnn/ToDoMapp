import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Check, Clock3, RefreshCw, SlidersHorizontal } from "lucide-react";
import type {
  ReplanProposalDetail,
  RoadmapItem,
  RoadmapTaskRef,
  TimeFixedOption,
  TimeFixedResolution,
} from "@api-types";
import { morningBriefApi, replanApi } from "@/api";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { calmMessage } from "@/lib/apiError";

type TimeFixedDecision = {
  choice: TimeFixedOption;
  new_fixed_date?: string | null;
};

export function MorningBriefSheet({
  open,
  onClose,
  onOpenRoadmap,
}: {
  open: boolean;
  onClose: () => void;
  onOpenRoadmap: () => void;
}) {
  const qc = useQueryClient();
  const brief = useQuery({ queryKey: ["morning-brief"], queryFn: morningBriefApi.get });
  const [selectedToday, setSelectedToday] = useState<Set<string>>(new Set());
  const [timeFixedDecisions, setTimeFixedDecisions] = useState<Record<string, TimeFixedDecision | undefined>>({});
  const preview = useMutation({
    mutationFn: (body: { proposalId: string; today_task_ids: string[]; time_fixed_resolutions: TimeFixedResolution[] }) =>
      replanApi.recoveryPreview(body.proposalId, {
        today_task_ids: body.today_task_ids,
        time_fixed_resolutions: body.time_fixed_resolutions,
      }),
  });
  const apply = useMutation({
    mutationFn: (body: { proposalId: string; today_task_ids: string[]; time_fixed_resolutions: TimeFixedResolution[] }) =>
      replanApi.recoveryApply(body.proposalId, {
        today_task_ids: body.today_task_ids,
        time_fixed_resolutions: body.time_fixed_resolutions,
      }),
    onSuccess: (detail) => {
      preview.reset();
      qc.setQueryData(["replan-proposal", detail.proposal.id], detail);
      void qc.invalidateQueries({ queryKey: ["morning-brief"] });
      void qc.invalidateQueries({ queryKey: ["roadmap"] });
      void qc.invalidateQueries({ queryKey: ["replan-proposals"] });
    },
  });

  const pending = brief.data?.pending_replan ?? null;
  const pendingRecovery = pending?.changes.recovery ? pending : null;
  const activeDetail = apply.data ?? preview.data ?? pendingRecovery;
  const recovery = activeDetail?.changes.recovery ?? brief.data?.recovery ?? null;

  useEffect(() => {
    if (!open || !recovery) return;
    setSelectedToday(new Set(recovery.selected_today_task_ids));
    setTimeFixedDecisions({});
  }, [open, recovery?.local_date, recovery?.slipped_task_ids.join("|")]);

  const timeFixedConflicts = activeDetail?.changes.time_fixed_conflicts ?? [];
  const timeFixedResolutions = useMemo(
    () =>
      Object.entries(timeFixedDecisions)
        .map(([task_id, decision]): TimeFixedResolution | null => {
          if (!decision) return null;
          return decision.choice === "renegotiate"
            ? { task_id, choice: "renegotiate", new_fixed_date: decision.new_fixed_date }
            : { task_id, choice: decision.choice };
        })
        .filter((resolution): resolution is TimeFixedResolution => resolution != null),
    [timeFixedDecisions],
  );
  const unresolvedTimeFixed = timeFixedConflicts.filter((conflict) => {
    const decision = timeFixedDecisions[conflict.task_id];
    return !decision || (decision.choice === "renegotiate" && !decision.new_fixed_date);
  });
  const taskRefs = activeDetail?.refs.tasks ?? {};
  const slippedTaskIds = recovery?.slipped_task_ids ?? [];
  const flexibleSlippedTasks = slippedTaskIds
    .map((taskId) => taskRefs[taskId])
    .filter((task): task is RoadmapTaskRef => Boolean(task && !task.is_time_fixed));
  const selectedIds = [...selectedToday];
  const visibleRecoveryTaskCount =
    flexibleSlippedTasks.length ||
    recovery?.selected_today_task_ids.length ||
    recovery?.pushed_future_task_ids.length ||
    recovery?.slipped_task_ids.length ||
    0;
  const todayChoiceCount = pendingRecovery ? selectedToday.size : recovery?.selected_today_task_ids.length ?? 0;
  const futureChoiceCount = pendingRecovery
    ? Math.max(visibleRecoveryTaskCount - selectedToday.size, 0)
    : recovery?.pushed_future_task_ids.length ?? 0;
  const previewDays = recoveryPreviewDays(activeDetail, slippedTaskIds);
  const applied =
    (!pendingRecovery && Boolean(brief.data?.recovery)) ||
    activeDetail?.proposal.status === "approved" ||
    activeDetail?.proposal.status === "edited_approved";
  const canApply = Boolean(pendingRecovery && recovery) && unresolvedTimeFixed.length === 0 && !applied;

  function runPreview() {
    if (!pendingRecovery) return;
    preview.mutate({
      proposalId: pendingRecovery.proposal.id,
      today_task_ids: selectedIds,
      time_fixed_resolutions: timeFixedResolutions,
    });
  }

  function runApply() {
    if (!pendingRecovery) return;
    apply.mutate({
      proposalId: pendingRecovery.proposal.id,
      today_task_ids: selectedIds,
      time_fixed_resolutions: timeFixedResolutions,
    });
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Morning brief"
      subtitle={brief.data?.position.today ?? "Today"}
      width="max-w-xl"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onOpenRoadmap}>
            Open roadmap
            <ArrowRight size={14} />
          </Button>
          {pendingRecovery && recovery && !applied && (
            <>
              <Button size="sm" variant="secondary" onClick={runPreview} disabled={preview.isPending || apply.isPending}>
                <RefreshCw size={14} />
                Preview
              </Button>
              <Button size="sm" onClick={runApply} disabled={!canApply || apply.isPending}>
                {apply.isPending ? "Applying..." : "Apply recovery"}
              </Button>
            </>
          )}
        </div>
      }
    >
      {brief.isLoading ? (
        <p className="text-sm font-semibold text-text-tertiary">Loading brief...</p>
      ) : brief.isError || !brief.data ? (
        <p className="text-sm font-bold text-warning">{calmMessage(brief.error)}</p>
      ) : (
        <div className="space-y-5">
          <section className="rounded-[12px] border border-border bg-surface-1 p-4">
            <div className="flex items-center gap-2">
              <Clock3 size={15} className="text-progress" />
              <p className="text-sm font-black text-text-primary">Today</p>
              <span className="ml-auto font-mono text-xs font-black text-progress">
                {brief.data.today?.items.filter((entry) => entry.item.status === "completed").length ?? 0}/
                {brief.data.today?.items.length ?? 0}
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {(brief.data.today?.items ?? []).map((entry) => (
                <div key={entry.item.id} className="rounded-[10px] border border-border bg-bg px-3 py-2">
                  <p className="truncate text-sm font-extrabold text-text-primary">{entry.task?.title ?? "Task"}</p>
                  <p className="mt-0.5 text-[11px] font-semibold text-text-tertiary">
                    {entry.item.status === "completed" ? "Completed" : "Planned"} · {entry.task?.project_title ?? "Project"}
                  </p>
                </div>
              ))}
              {!brief.data.today?.items.length && (
                <p className="text-sm font-semibold text-text-tertiary">No tasks planned today.</p>
              )}
            </div>
          </section>

          {recovery ? (
            <section className="rounded-[12px] border border-system/40 bg-system-soft p-4">
              <div className="mb-3 flex items-center gap-2">
                <SlidersHorizontal size={15} className="text-system" />
                <p className="text-sm font-black text-system">Recovery proposal</p>
                {applied && (
                  <span className="ml-auto rounded-full bg-progress-soft px-2 py-0.5 text-[10px] font-black text-progress">
                    applied
                  </span>
                )}
              </div>
              <p className="mb-3 text-xs font-semibold text-text-secondary">
                {recovery.slipped_task_ids.length} task{recovery.slipped_task_ids.length === 1 ? "" : "s"} from{" "}
                {recovery.slipped_dates.join(", ")}{" "}
                {applied ? "were recovered into the roadmap." : "need a new place on the roadmap."}
              </p>
              <div className="mb-3 grid grid-cols-2 gap-2">
                <div className="rounded-[10px] border border-border bg-bg px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-wider text-text-tertiary">Today</p>
                  <p className="font-mono text-sm font-black text-progress">{todayChoiceCount}</p>
                </div>
                <div className="rounded-[10px] border border-border bg-bg px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-wider text-text-tertiary">Later</p>
                  <p className="font-mono text-sm font-black text-text-primary">{futureChoiceCount}</p>
                </div>
              </div>
              <div className="space-y-2">
                {flexibleSlippedTasks.map((task) => {
                  const checked = selectedToday.has(task.id);
                  return (
                    <label key={task.id} className="flex items-start gap-2 rounded-[10px] border border-border bg-bg px-3 py-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={applied}
                        onChange={() =>
                          setSelectedToday((prev) => {
                            const next = new Set(prev);
                            if (next.has(task.id)) next.delete(task.id);
                            else next.add(task.id);
                            return next;
                          })
                        }
                        className="mt-1 h-4 w-4 flex-none accent-[var(--accent-progress)]"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-extrabold text-text-primary">{task.title}</span>
                        <span className="block text-[11px] font-semibold text-text-tertiary">
                          {checked ? "Do today" : "Push to future"} · {task.project_title}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>

              {timeFixedConflicts.length > 0 && (
                <div className="mt-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-black text-warning">
                    <AlertTriangle size={14} />
                    Time-fixed decisions
                  </div>
                  {timeFixedConflicts.map((conflict) => (
                    <TimeFixedDecisionRow
                      key={conflict.task_id}
                      conflict={conflict}
                      taskTitle={taskRefs[conflict.task_id]?.title ?? "Time-fixed task"}
                      value={timeFixedDecisions[conflict.task_id]}
                      disabled={applied}
                      onChange={(decision) =>
                        setTimeFixedDecisions((prev) => ({ ...prev, [conflict.task_id]: decision }))
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          ) : (
            <section className="rounded-[12px] border border-border bg-surface-1 p-4">
              <div className="flex items-center gap-2 text-sm font-black text-progress">
                <Check size={15} />
                No recovery pending
              </div>
            </section>
          )}

          {activeDetail?.changes.milestone_impacts.length ? (
            <section className="rounded-[12px] border border-border bg-surface-1 p-4">
              <p className="mb-2 text-sm font-black">Milestone impact</p>
              <div className="space-y-1.5">
                {activeDetail.changes.milestone_impacts.map((impact) => (
                  <p key={impact.milestone_id} className="text-xs font-semibold text-text-secondary">
                    {impact.title}: {impact.from_projected_date ?? "unscheduled"} {"->"}{" "}
                    {impact.to_projected_date ?? "unscheduled"}
                  </p>
                ))}
              </div>
            </section>
          ) : null}

          {previewDays.length > 0 && (
            <section className="rounded-[12px] border border-border bg-surface-1 p-4">
              <p className="mb-3 text-sm font-black">Proposed placement</p>
              <div className="space-y-2">
                {previewDays.map((day) => (
                  <div key={day.date} className="rounded-[10px] border border-border bg-bg px-3 py-2">
                    <p className="mb-1 font-mono text-xs font-black text-text-secondary">{day.date}</p>
                    <div className="space-y-1">
                      {day.items
                        .filter((item) => slippedTaskIds.includes(item.task_id))
                        .map((item) => (
                          <p key={`${day.date}-${item.task_id}`} className="truncate text-xs font-extrabold text-text-primary">
                            {item.task?.title ?? taskRefs[item.task_id]?.title ?? "Task"}
                          </p>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {(preview.error || apply.error) && (
            <p className="rounded-[10px] border border-warning/40 bg-warning-soft px-3 py-2 text-xs font-bold text-warning">
              {calmMessage(preview.error ?? apply.error)}
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}

function TimeFixedDecisionRow({
  conflict,
  taskTitle,
  value,
  disabled,
  onChange,
}: {
  conflict: { task_id: string; fixed_date: string | null; reason: string };
  taskTitle: string;
  value: TimeFixedDecision | undefined;
  disabled: boolean;
  onChange: (decision: TimeFixedDecision | undefined) => void;
}) {
  return (
    <div className="rounded-[10px] border border-warning/30 bg-bg px-3 py-2">
      <p className="truncate text-xs font-extrabold text-text-primary">{taskTitle}</p>
      <p className="mt-0.5 text-[11px] font-semibold text-text-tertiary">{conflict.reason}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_150px]">
        <select
          value={value?.choice ?? ""}
          disabled={disabled}
          onChange={(event) => {
            const choice = event.target.value as TimeFixedOption | "";
            onChange(choice ? { choice, new_fixed_date: choice === "renegotiate" ? conflict.fixed_date ?? "" : null } : undefined);
          }}
          className="h-9 rounded-md border border-border bg-surface-1 px-2 text-xs font-bold text-text-primary"
        >
          <option value="">Choose...</option>
          <option value="prioritize">Do today</option>
          <option value="descope">Descope</option>
          <option value="renegotiate">Renegotiate date</option>
        </select>
        <input
          type="date"
          disabled={disabled || value?.choice !== "renegotiate"}
          value={value?.new_fixed_date ?? ""}
          onChange={(event) => value && onChange({ ...value, new_fixed_date: event.target.value })}
          className="h-9 rounded-md border border-border bg-surface-1 px-2 text-xs font-bold text-text-primary disabled:opacity-40"
        />
      </div>
    </div>
  );
}

function recoveryPreviewDays(detail: ReplanProposalDetail | null, slippedTaskIds: string[]) {
  if (!detail?.preview?.roadmap) return [];
  const slipped = new Set(slippedTaskIds);
  return detail.preview.roadmap.days
    .map((day) => ({
      ...day,
      items: day.items.filter((item): item is RoadmapItem => slipped.has(item.task_id)),
    }))
    .filter((day) => day.items.length > 0)
    .slice(0, 6);
}
