/**
 * Onboarding (web-screens §A, Journey A — "from ambition to roadmap").
 *
 * A focused, linear flow OUTSIDE the app shell. Each step commits via its real
 * /v1 write (save-per-step), so abandoning mid-flow leaves a valid partial WBS
 * and re-entry resumes (see useOnboardingResume). The wizard owns the mutable
 * step/goalId/projectId state; the resume hook seeds it exactly once.
 */
import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useOnboardingResume, type OnboardingResume } from "./useOnboardingResume";
import { Stepper } from "./Stepper";
import type { WizardCtx } from "./types";
import { StepGoal } from "./steps/StepGoal";
import { StepProject } from "./steps/StepProject";
import { StepFirstMilestone } from "./steps/StepFirstMilestone";
import { StepBreakdown } from "./steps/StepBreakdown";
import { StepGroup } from "./steps/StepGroup";
import { StepCapacity } from "./steps/StepCapacity";
import { StepRoadmap } from "./steps/StepRoadmap";

export function Onboarding() {
  const resume = useOnboardingResume();

  if (resume.isLoading) {
    return <FullScreen>Picking up where you left off…</FullScreen>;
  }
  if (resume.isError || !resume.data) {
    return (
      <FullScreen tone="warning">
        Couldn’t load your workspace.{" "}
        {resume.error instanceof Error ? resume.error.message : "Please retry."}
      </FullScreen>
    );
  }
  if (resume.data.complete) {
    // Already past onboarding (a confirmed day exists) — never re-enter the flow.
    return <Navigate to="/home" replace />;
  }

  // Keyed by the resolved step so the wizard mounts once with seeded state.
  return <Wizard key="wizard" initial={resume.data} />;
}

function Wizard({ initial }: { initial: OnboardingResume }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(initial.step);
  const [goalId, setGoalId] = useState<string | null>(initial.goal?.id ?? null);
  const [projectId, setProjectId] = useState<string | null>(initial.project?.id ?? null);

  const ctx: WizardCtx = {
    goalId,
    projectId,
    initialGoal: initial.goal,
    initialProject: initial.project,
    setGoalId,
    setProjectId,
    next: () => setStep((s) => Math.min(s + 1, 6)),
    back: () => setStep((s) => Math.max(s - 1, 0)),
    finish: () => {
      // The whole app reads change once a day is confirmed — refetch on landing.
      void qc.invalidateQueries();
      navigate("/home", { replace: true });
    },
  };

  const steps = [
    <StepGoal ctx={ctx} />,
    <StepProject ctx={ctx} />,
    <StepFirstMilestone ctx={ctx} />,
    <StepBreakdown ctx={ctx} />,
    <StepGroup ctx={ctx} />,
    <StepCapacity ctx={ctx} />,
    <StepRoadmap ctx={ctx} />,
  ];

  return (
    <div
      className="min-h-full px-6 py-10"
      style={{ background: "radial-gradient(1200px 600px at 50% -10%, var(--backdrop-glow), var(--bg))" }}
    >
      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-7">
        <div className="flex items-center gap-2.5">
          <span className="flex h-[28px] w-[28px] items-center justify-center rounded-[8px] bg-progress text-[15px] font-black text-on-accent">
            ▲
          </span>
          <span className="text-[14px] font-black">TodoMapp</span>
        </div>

        <Stepper active={step} />

        <div className="rounded-[20px] border border-border bg-surface-1 p-7">{steps[step]}</div>
      </div>
    </div>
  );
}

function FullScreen({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "warning";
}) {
  return (
    <div className="flex min-h-full items-center justify-center px-6 py-12">
      <p
        className={
          tone === "warning"
            ? "max-w-[420px] text-center text-sm font-bold text-warning"
            : "text-sm font-bold text-text-tertiary"
        }
      >
        {children}
      </p>
    </div>
  );
}
