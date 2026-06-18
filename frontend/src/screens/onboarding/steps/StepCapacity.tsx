/**
 * A5 — Set Capacity. The project was created at A2 with a placeholder capacity;
 * here the user confirms or changes the real value, which we PATCH onto the
 * project. Propose (A6) runs after this, so the planner always fills days to the
 * user's chosen hours, never the silent placeholder.
 *
 * Per the locked UI note: the prefilled value is presented as a STARTING POINT to
 * confirm — not a hidden default — so nobody ships a roadmap on a placeholder.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { projectsApi } from "@/api";
import { calmMessage } from "@/lib/apiError";
import { DEFAULT_CAPACITY_HOURS } from "../constants";
import { Input, Field } from "@/components/ui/input";
import { StepHeader, InlineError, NavRow } from "./_chrome";
import type { StepProps } from "../types";

export function StepCapacity({ ctx }: StepProps) {
  const projectId = ctx.projectId;
  const project = useQuery({
    queryKey: ["onb-project", projectId],
    queryFn: () => projectsApi.get(projectId!),
    enabled: !!projectId,
  });

  const [hours, setHours] = useState<string>("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Seed the input from the project's current capacity once it loads.
  useEffect(() => {
    if (project.data && hours === "") {
      const current = Number(project.data.capacity_hours_per_day);
      setHours(String(Number.isFinite(current) ? current : DEFAULT_CAPACITY_HOURS));
    }
  }, [project.data, hours]);

  const n = Number(hours);
  const valid = Number.isFinite(n) && n > 0 && n <= 24;
  const isStartingValue = !touched && Number(project.data?.capacity_hours_per_day) === DEFAULT_CAPACITY_HOURS;

  async function onContinue() {
    if (!valid || !projectId) return;
    setBusy(true);
    setError(null);
    try {
      await projectsApi.update(projectId, { capacity_hours_per_day: n });
      ctx.next();
    } catch (err) {
      setError(calmMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <StepHeader
        title="How many hours per day for this project?"
        subtitle="The planner fills each day up to this. You can change it any time later."
      />

      {isStartingValue && (
        <p className="rounded-[10px] border border-system/40 bg-system-soft px-3 py-2 text-xs font-bold text-system">
          We’ve put {DEFAULT_CAPACITY_HOURS}h as a starting point — confirm or change it before we plan.
        </p>
      )}

      <Field label="Hours per day" hint="Between 0 and 24.">
        <Input
          type="number"
          min={0.25}
          max={24}
          step={0.25}
          inputMode="decimal"
          autoFocus
          value={hours}
          onChange={(e) => {
            setTouched(true);
            setHours(e.target.value);
          }}
          className="w-40"
        />
      </Field>

      <InlineError message={error} />
      <NavRow
        onBack={ctx.back}
        primaryLabel="Generate my roadmap →"
        onPrimary={onContinue}
        primaryDisabled={!valid}
        busy={busy}
      />
    </div>
  );
}
