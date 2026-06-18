/**
 * A2 — Create the first Project. POST /goals/{id}/projects (or PATCH on
 * resume/back). The API requires a capacity, but the user picks it at A5 — so we
 * create with DEFAULT_CAPACITY_HOURS and A5 PATCHes the real value (the plan's
 * locked save-per-step resolution). Capacity is NOT shown here.
 */
import { useState, type FormEvent } from "react";
import { goalsApi, projectsApi } from "@/api";
import { calmMessage } from "@/lib/apiError";
import { Input, Textarea, Field } from "@/components/ui/input";
import { StepHeader, InlineError, NavRow } from "./_chrome";
import { DEFAULT_CAPACITY_HOURS } from "../constants";
import type { StepProps } from "../types";

export function StepProject({ ctx }: StepProps) {
  const p = ctx.initialProject;
  const [title, setTitle] = useState(p?.title ?? "");
  const [description, setDescription] = useState(p?.description ?? "");
  const [targetEnd, setTargetEnd] = useState(p?.target_end_date ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !ctx.goalId) return;
    setBusy(true);
    setError(null);
    try {
      const base = {
        title: title.trim(),
        description: description.trim() || null,
        target_end_date: targetEnd || null,
      };
      if (ctx.projectId) {
        await projectsApi.update(ctx.projectId, base);
      } else {
        const project = await goalsApi.createProject(ctx.goalId, {
          ...base,
          capacity_hours_per_day: DEFAULT_CAPACITY_HOURS, // placeholder; confirmed at A5
        });
        ctx.setProjectId(project.id);
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
        title="What’s a concrete initiative toward this goal?"
        subtitle="A project is the body of work that moves the goal forward."
      />

      <Field label="Project">
        <Input
          autoFocus
          placeholder="e.g. Build and ship the MVP"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>

      <Field label="Description (optional)">
        <Textarea
          placeholder="What does done look like?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>

      <Field label="Target end date (optional)">
        <Input type="date" value={targetEnd ?? ""} onChange={(e) => setTargetEnd(e.target.value)} />
      </Field>

      <InlineError message={error} />
      <NavRow
        onBack={ctx.back}
        primaryType="submit"
        primaryLabel="Continue →"
        primaryDisabled={!title.trim()}
        busy={busy}
      />
    </form>
  );
}
