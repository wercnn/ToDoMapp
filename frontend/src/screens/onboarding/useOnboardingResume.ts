/**
 * Resume detection (F2 plan, point 2) — the one genuinely tricky bit.
 *
 * Onboarding commits SAVE-PER-STEP via real /v1 writes, so a user can abandon
 * mid-flow and a partial WBS is a valid, non-broken state. On (re)entry we run a
 * short read-only ladder and drop the user at the right step rather than
 * restarting (which would duplicate) or stranding them.
 *
 * The ladder is keyed off existing entities, so re-entry REUSES them — it never
 * creates a second goal/project. Up to three sequential reads decide the step:
 *
 *   GET /roadmap   → any confirmed/completed day?  → onboarding DONE (→ Home)
 *                  → any proposed day?             → resume at A6 (review)
 *   GET /goals     → none?                         → A1
 *   .../projects   → none?                         → A2
 *   else (project exists, not yet proposed)        → A3 (walk forward; A4/A5 are
 *                                                    optional/defaulted so they have
 *                                                    no partial-state signal)
 *
 * A1/A2 prefill from the found goal/project so Back-edit persists via PATCH.
 */
import { useQuery } from "@tanstack/react-query";
import { goalsApi, projectsApi, roadmapApi } from "@/api";
import type { Goal, Project } from "@api-types";

export const STEP = {
  GOAL: 0,
  PROJECT: 1,
  MILESTONE: 2,
  BREAKDOWN: 3,
  GROUP: 4,
  CAPACITY: 5,
  ROADMAP: 6,
} as const;

export interface OnboardingResume {
  /** Onboarding is finished — the user has confirmed at least one day. */
  complete: boolean;
  /** Step index to start at (ignored when complete). */
  step: number;
  goal: Goal | null;
  project: Project | null;
}

async function detect(): Promise<OnboardingResume> {
  const roadmap = await roadmapApi.get();
  const hasConfirmedDay = roadmap.days.some(
    (d) => d.status === "confirmed" || d.status === "completed",
  );
  if (hasConfirmedDay) {
    return { complete: true, step: STEP.ROADMAP, goal: null, project: null };
  }
  const hasProposedDay = roadmap.days.some((d) => d.status === "proposed");

  const goals = await goalsApi.list();
  const goal = goals[0]; // first-run onboarding assumes a single goal (multi-goal deferred)
  if (!goal) {
    return { complete: false, step: STEP.GOAL, goal: null, project: null };
  }

  const projects = await goalsApi.listProjects(goal.id);
  const project = projects[0];
  if (!project) {
    return { complete: false, step: STEP.PROJECT, goal, project: null };
  }

  if (hasProposedDay) {
    return { complete: false, step: STEP.ROADMAP, goal, project };
  }
  const milestones = await projectsApi.listMilestones(project.id);
  if (milestones.length === 0) {
    return { complete: false, step: STEP.MILESTONE, goal, project };
  }
  // Project exists but nothing proposed yet → resume at the breakdown and let the
  // user walk forward through the optional milestone/capacity steps.
  return { complete: false, step: STEP.BREAKDOWN, goal, project };
}

export function useOnboardingResume() {
  return useQuery({
    queryKey: ["onboarding-resume"],
    queryFn: detect,
    staleTime: Infinity, // resolved once on entry; the wizard owns state after that
    gcTime: 30_000, // keep briefly so the EntryGate → Onboarding handoff reuses it
    refetchOnWindowFocus: false,
  });
}
