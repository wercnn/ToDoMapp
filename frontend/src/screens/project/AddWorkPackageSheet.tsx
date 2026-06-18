/**
 * Add-Work-Package sheet (web-screens §C.4 "[+ Work package]"). A mid-flight WP
 * add is a normal operation (§4.1): when confirmed roadmap days already exist the
 * backend returns a `replan_proposal` instead of silently touching the plan
 * (Principle 1). We surface that as a calm nudge that deep-links into ReplanReview —
 * the create itself never rewrites the roadmap.
 *
 * Reuses the F2 discriminated-union controls so the either/or estimate + time-fixed
 * pairing 422s are structurally prevented.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { MilestoneWithState } from "@api-types";
import { projectsApi } from "@/api";
import type { WorkPackageBody } from "@/api";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { calmMessage } from "@/lib/apiError";
import {
  EstimateControl,
  TimeFixedControl,
  estimationBody,
  timeFixedBody,
  EMPTY_ESTIMATE,
  EMPTY_TIME_FIXED,
  type EstimateValue,
  type TimeFixedValue,
} from "@/screens/onboarding/fields";

export function AddWorkPackageSheet({
  projectId,
  milestones,
  open,
  onClose,
  onCreated,
  onProposal,
}: {
  projectId: string;
  milestones: MilestoneWithState[];
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  /** Called with the proposal id when a mid-flight add produced one. */
  onProposal: (proposalId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [milestoneId, setMilestoneId] = useState("");
  const [estimate, setEstimate] = useState<EstimateValue>(EMPTY_ESTIMATE);
  const [timeFixed, setTimeFixed] = useState<TimeFixedValue>(EMPTY_TIME_FIXED);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setTitle("");
    setMilestoneId("");
    setEstimate(EMPTY_ESTIMATE);
    setTimeFixed(EMPTY_TIME_FIXED);
    setError(null);
  }

  const create = useMutation({
    mutationFn: () => {
      const tf = timeFixedBody(timeFixed);
      if (tf == null) throw new Error("Pick a date for the time-fixed work package.");
      const body: WorkPackageBody = {
        title: title.trim(),
        milestone_id: milestoneId || null,
        ...estimationBody(estimate),
        ...tf,
      };
      return projectsApi.createWorkPackage(projectId, body);
    },
    onSuccess: (res) => {
      onCreated();
      reset();
      onClose();
      if (res.replan_proposal) onProposal(res.replan_proposal.id);
    },
    onError: (e) => setError(calmMessage(e)),
  });

  return (
    <Sheet
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="New work package"
      footer={
        <div className="flex justify-end">
          <Button
            disabled={!title.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Creating…" : "Create work package"}
          </Button>
        </div>
      }
    >
      {error && (
        <p className="mb-3 rounded-[10px] bg-warning-soft px-3 py-2 text-xs font-bold text-warning">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-4">
        <Field label="Title">
          <Input
            autoFocus
            value={title}
            placeholder="e.g. Design system"
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="Milestone">
          <select
            value={milestoneId}
            onChange={(e) => setMilestoneId(e.target.value)}
            className="w-full rounded-[11px] border border-border bg-bg px-4 py-3 text-[15px] font-bold text-text-primary outline-none focus:border-progress"
          >
            <option value="">No milestone</option>
            {milestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Estimate">
          <EstimateControl value={estimate} onChange={setEstimate} />
        </Field>
        <Field label="Scheduling">
          <TimeFixedControl value={timeFixed} onChange={setTimeFixed} />
        </Field>
      </div>
    </Sheet>
  );
}
