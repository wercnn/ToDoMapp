/**
 * Prototype milestone preview step: creates the first landmark before the user
 * breaks the project into work packages.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, Sparkles } from "lucide-react";
import { projectsApi } from "@/api";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { calmMessage } from "@/lib/apiError";
import { StepHeader, InlineError, NavRow } from "./_chrome";
import type { StepProps } from "../types";

export function StepFirstMilestone({ ctx }: StepProps) {
  const qc = useQueryClient();
  const projectId = ctx.projectId;
  const milestones = useQuery({
    queryKey: ["onb-milestones", projectId],
    queryFn: () => projectsApi.listMilestones(projectId!),
    enabled: !!projectId,
  });
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const create = useMutation({
    mutationFn: () => projectsApi.createMilestone(projectId!, { title: title.trim(), description: description || null }),
    onSuccess: () => {
      setTitle("");
      setDescription("");
      void qc.invalidateQueries({ queryKey: ["onb-milestones", projectId] });
    },
  });

  const list = milestones.data ?? [];
  const first = list[0];

  return (
    <div className="flex flex-col gap-5">
      <StepHeader
        title="Set the first milestone"
        subtitle="Give the roadmap a visible landmark. Work packages can be assigned to it in the grouping step."
      />
      <InlineError message={create.isError ? calmMessage(create.error) : null} />

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
        <section className="flex flex-col gap-3">
          <Field label="Milestone title">
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Private beta ready"
            />
          </Field>
          <Field label="Notes">
            <Textarea value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <Button
            type="button"
            variant="secondary"
            disabled={!title.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            <Flag size={16} />
            Add milestone
          </Button>
        </section>

        <aside className="rounded-[14px] border border-system/40 bg-system-soft p-4">
          <div className="mb-4 flex items-center gap-2 text-system">
            <Sparkles size={16} />
            <span className="text-xs font-black uppercase tracking-wider">Preview</span>
          </div>
          <div className="flex min-h-[140px] flex-col items-center justify-center gap-3 text-center">
            <span className="grid h-12 w-12 rotate-45 place-items-center rounded-[8px] border border-system bg-bg">
              <Flag size={18} className="-rotate-45 text-system" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-black text-text-primary">{first?.title ?? (title || "First milestone")}</p>
              <p className="mt-1 text-xs font-semibold text-system">This becomes a landmark on your path.</p>
            </div>
          </div>
        </aside>
      </div>

      {list.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {list.map((milestone) => (
            <span
              key={milestone.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg px-3 py-1.5 text-xs font-extrabold text-text-secondary"
            >
              <Flag size={13} className="text-system" />
              {milestone.title}
            </span>
          ))}
        </div>
      )}

      <NavRow
        onBack={ctx.back}
        primaryLabel="Continue →"
        onPrimary={ctx.next}
        primaryDisabled={list.length === 0}
      />
      {list.length === 0 && (
        <p className="-mt-3 text-right text-[11px] font-semibold text-text-tertiary">
          Add at least one milestone to continue.
        </p>
      )}
    </div>
  );
}
