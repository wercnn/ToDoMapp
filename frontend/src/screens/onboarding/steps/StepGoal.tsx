/**
 * A1 — Create your first Goal. POST /goals (or PATCH on resume/back, so a
 * returning user edits rather than duplicates). Commits, then advances.
 */
import { useState, type FormEvent } from "react";
import { goalsApi } from "@/api";
import type { GoalHorizon } from "@api-types";
import { calmMessage } from "@/lib/apiError";
import { cn } from "@/lib/utils";
import { Input, Textarea, Field } from "@/components/ui/input";
import { StepHeader, InlineError, NavRow } from "./_chrome";
import type { StepProps } from "../types";

const HORIZONS: { value: GoalHorizon; label: string; hint: string }[] = [
  { value: "short", label: "Short term", hint: "weeks" },
  { value: "mid", label: "Mid term", hint: "months" },
  { value: "long", label: "Long term", hint: "a year+" },
];

export function StepGoal({ ctx }: StepProps) {
  const g = ctx.initialGoal;
  const [title, setTitle] = useState(g?.title ?? "");
  const [horizon, setHorizon] = useState<GoalHorizon>(g?.horizon ?? "mid");
  const [description, setDescription] = useState(g?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const body = { title: title.trim(), horizon, description: description.trim() || null };
      if (ctx.goalId) {
        await goalsApi.update(ctx.goalId, body); // resumed/back — no duplicate
      } else {
        const goal = await goalsApi.create(body);
        ctx.setGoalId(goal.id);
      }
      ctx.next();
    } catch (err) {
      setError(calmMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <StepHeader
        title="What outcome are you pursuing?"
        subtitle="Start with the ambition. We’ll break it into a plan together, one step at a time."
      />

      <Field label="Goal">
        <Input
          autoFocus
          placeholder="e.g. Launch my side project"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>

      <Field label="Horizon">
        <div className="grid grid-cols-3 gap-2">
          {HORIZONS.map((h) => (
            <button
              key={h.value}
              type="button"
              onClick={() => setHorizon(h.value)}
              className={cn(
                "flex flex-col items-start rounded-[11px] border px-3 py-2.5 text-left transition-colors",
                horizon === h.value
                  ? "border-progress bg-progress-soft"
                  : "border-border bg-bg hover:bg-surface-2",
              )}
            >
              <span className="text-[13px] font-extrabold">{h.label}</span>
              <span className="text-[11px] font-semibold text-text-tertiary">{h.hint}</span>
            </button>
          ))}
        </div>
      </Field>

      <Field label="Description (optional)">
        <Textarea
          placeholder="Why does this matter to you?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>

      <InlineError message={error} />
      <NavRow primaryType="submit" primaryLabel="Continue →" primaryDisabled={!title.trim()} busy={busy} />
    </form>
  );
}
