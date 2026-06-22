/**
 * Add-Work-Package sheet (web-screens §C.4 "[+ Work package]"). A mid-flight WP
 * add is a normal operation (§4.1): it creates the work directly and the user can
 * request a manual replan when they want to reorganize the roadmap.
 *
 * Reuses the F2 discriminated-union controls so the either/or estimate + time-fixed
 * pairing 422s are structurally prevented.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { X } from "lucide-react";
import type { MilestoneWithState } from "@api-types";
import { projectsApi } from "@/api";
import type { WorkPackageBody } from "@/api";
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
}: {
  projectId: string;
  milestones: MilestoneWithState[];
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [milestoneId, setMilestoneId] = useState("");
  const [estimate, setEstimate] = useState<EstimateValue>(EMPTY_ESTIMATE);
  const [timeFixed, setTimeFixed] = useState<TimeFixedValue>(EMPTY_TIME_FIXED);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

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
    onSuccess: () => {
      onCreated();
      reset();
      onClose();
    },
    onError: (e) => setError(calmMessage(e)),
  });

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  function close() {
    reset();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--scrim)] px-4 py-6">
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-full w-full max-w-[520px] flex-col rounded-[16px] border border-border bg-bg shadow-2xl"
      >
        <header className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-black text-text-primary">New work package</h2>
            <p className="mt-0.5 text-xs font-semibold text-text-tertiary">
              Add a planning unit; use Replan when you want to reorganize the roadmap.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-text-tertiary hover:bg-surface-2 hover:text-text-primary"
            aria-label="Close"
          >
            <X size={17} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
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
        </div>
        <footer className="flex justify-end border-t border-border px-5 py-4">
          <Button disabled={!title.trim() || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? "Creating..." : "Create work package"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
