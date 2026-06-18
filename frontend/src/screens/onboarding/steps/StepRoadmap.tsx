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
import { Flag, RefreshCw } from "lucide-react";
import { daysApi, roadmapApi } from "@/api";
import type { ProposedDay } from "@api-types";
import { calmMessage } from "@/lib/apiError";
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

      {proposedDays.length > 0 && (
        <div className="relative overflow-x-auto rounded-[18px] border border-border bg-bg p-5">
          <div className="absolute left-10 right-10 top-[52px] h-1 rounded-full bg-system-soft" />
          <div className="relative flex min-w-max items-start gap-5 pb-1">
            {proposedDays.map((day, index) => {
              const milestone = milestones.find((m) => m.projected_date === day.date);
              return (
                <div key={day.date} className="flex w-[160px] flex-col items-center gap-3">
                  <span className="grid h-12 w-12 place-items-center rounded-full border-2 border-system bg-system-soft font-mono text-sm font-black text-system shadow-[0_0_0_6px_var(--bg)]">
                    {index + 1}
                  </span>
                  {milestone && (
                    <span className="grid h-10 w-10 rotate-45 place-items-center rounded-[8px] border border-system bg-bg text-system">
                      <Flag size={15} className="-rotate-45" />
                    </span>
                  )}
                  <div className="w-full rounded-[12px] border border-system/30 bg-surface-1 p-3 text-center">
                    <p className="font-mono text-xs font-black text-text-primary">{day.date}</p>
                    <p className="mt-1 text-[11px] font-bold text-system">proposed day</p>
                    <div className="mt-3 flex flex-col gap-1 text-left">
                      {day.items.length === 0 && (
                        <span className="truncate text-[11px] font-semibold text-text-tertiary">Rest day</span>
                      )}
                      {day.items.slice(0, 3).map((item) => (
                        <span key={item.task_id} className="truncate text-[11px] font-bold text-text-secondary">
                          {item.task?.title ?? "Task"}
                        </span>
                      ))}
                      {day.items.length > 3 && (
                        <span className="text-[11px] font-bold text-text-tertiary">+{day.items.length - 3} more</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
            <RefreshCw size={15} />
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
