/** Shared wizard context passed to every onboarding step. */
import type { Goal, Project } from "@api-types";

export interface WizardCtx {
  goalId: string | null;
  projectId: string | null;
  /** Prefill values when a step is resumed/revisited (A1/A2 edit → PATCH, no dup). */
  initialGoal: Goal | null;
  initialProject: Project | null;
  setGoalId: (id: string) => void;
  setProjectId: (id: string) => void;
  next: () => void;
  back: () => void;
  /** A7 confirm — leave onboarding for the live app shell. */
  finish: () => void;
}

export interface StepProps {
  ctx: WizardCtx;
}
