/**
 * A6 — First Roadmap (proposed) + A7 — Confirm the first day. The "moment of
 * magic": POST /roadmap/propose materializes proposed day-steps, rendered as the
 * path with milestone landmarks. Confirming is the ONLY route to a confirmed day
 * (invariant #5) and a deliberate user action (Principle 1).
 *
 * THE CONFIRM-DATE GOTCHA (plan point 3): the date passed to /days/{date}/confirm
 * is read from the propose RESPONSE's earliest day — never guessed/hardcoded, or
 * the confirm 404s. On resume we derive it from the persisted proposed days in
 * GET /roadmap (same dates). We confirm the FIRST day here; later days are
 * confirmed in the normal daily loop.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { daysApi, roadmapApi } from "@/api";
import type { ProposedDay } from "@api-types";
import { calmMessage } from "@/lib/apiError";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { StepHeader, InlineError } from "./_chrome";
import type { StepProps } from "../types";

export function StepRoadmap({ ctx }: StepProps) {
  const qc = useQueryClient();
  const goalId = ctx.goalId ?? undefined;

  const roadmap = useQuery({ queryKey: ["onb-roadmap"], queryFn: () => roadmapApi.get() });
  const proposedDays = (roadmap.data?.days ?? [])
    .filter((d) => d.status === "proposed")
    .sort((a, b) => a.date.localeCompare(b.date));
  const milestones = (roadmap.data?.milestones ?? []).filter((m) => m.projected_date);

  // Confirm date comes from the propose RESPONSE when we just proposed; otherwise
  // from the persisted proposed days (resume). Never hardcoded.
  const [confirmDate, setConfirmDate] = useState<string | null>(null);
  const effectiveConfirmDate = confirmDate ?? proposedDays[0]?.date ?? null;

  const [autoTried, setAutoTried] = useState(false);

  const propose = useMutation({
    mutationFn: () => roadmapApi.propose({ goal_id: goalId }),
    onSuccess: (days: ProposedDay[]) => {
      const earliest = days.map((d) => d.day.plan_date).sort()[0] ?? null;
      setConfirmDate(earliest);
      void qc.invalidateQueries({ queryKey: ["onb-roadmap"] });
    },
  });

  // Auto-generate once on arrival if nothing is proposed yet (the "Generate" from A5).
  useEffect(() => {
    if (!roadmap.isLoading && proposedDays.length === 0 && !autoTried && !propose.isPending) {
      setAutoTried(true);
      propose.mutate();
    }
  }, [roadmap.isLoading, proposedDays.length, autoTried, propose]);

  const confirm = useMutation({
    mutationFn: () => daysApi.confirm(effectiveConfirmDate!),
    onSuccess: () => ctx.finish(),
  });

  const busy = propose.isPending || roadmap.isLoading;

  return (
    <div className="flex flex-col gap-4">
      <StepHeader
        title="Here’s your roadmap"
        subtitle="We’ve laid out your next days, filling each up to your capacity with unblocked work. Confirm your first day to enter your workspace."
      />

      <InlineError message={propose.isError ? calmMessage(propose.error) : null} />
      <InlineError message={confirm.isError ? calmMessage(confirm.error) : null} />

      {milestones.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {milestones.map((m) => (
            <span
              key={m.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-system-soft px-2.5 py-1 text-[11px] font-bold text-system"
            >
              🚩 {m.projected_date}
            </span>
          ))}
        </div>
      )}

      {busy && proposedDays.length === 0 && (
        <p className="rounded-[12px] border border-dashed border-border px-4 py-6 text-center text-sm font-semibold text-text-tertiary">
          Planning your days…
        </p>
      )}

      {!busy && proposedDays.length === 0 && (
        <p className="rounded-[12px] border border-dashed border-border px-4 py-6 text-center text-sm font-semibold text-text-tertiary">
          Nothing schedulable yet. Go back and add a few tasks with estimates, then generate again.
        </p>
      )}

      <div className="flex flex-col gap-2.5">
        {proposedDays.map((d, i) => (
          <div key={d.date} className="flex flex-col gap-2 rounded-[14px] border border-system/30 bg-surface-1 p-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-system-soft text-[12px] font-black text-system">
                {i + 1}
              </span>
              <span className="text-[13px] font-extrabold">{d.date}</span>
              <StatusPill status="proposed" className="ml-auto" />
            </div>
            <div className="flex flex-col gap-1 pl-9">
              {d.items.length === 0 && (
                <span className="text-[12px] font-semibold text-text-tertiary">Rest day</span>
              )}
              {d.items.map((it) => (
                <span key={it.task_id} className="text-[13px] font-bold text-text-secondary">
                  • {it.task?.title ?? "Task"}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <Button type="button" variant="ghost" onClick={ctx.back} disabled={busy || confirm.isPending}>
          ← Back
        </Button>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => propose.mutate()}
            disabled={busy || confirm.isPending}
          >
            Re-propose
          </Button>
          <Button
            type="button"
            onClick={() => confirm.mutate()}
            disabled={!effectiveConfirmDate || busy || confirm.isPending}
          >
            {confirm.isPending ? "Confirming…" : "Confirm & enter workspace →"}
          </Button>
        </div>
      </div>
    </div>
  );
}
