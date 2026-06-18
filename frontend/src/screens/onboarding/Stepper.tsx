/**
 * The onboarding stepper header (web-screens §A) — teaches the hierarchy as the
 * user builds it. Linear, with the current step emphasised and completed steps
 * marked. Purely presentational; the wizard owns the active index.
 */
import { cn } from "@/lib/utils";

export const STEP_LABELS = [
  "Goal",
  "Project",
  "Milestone",
  "Breakdown",
  "Group",
  "Capacity",
  "Roadmap",
] as const;

export function Stepper({ active }: { active: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
      {STEP_LABELS.map((label, i) => {
        const done = i < active;
        const current = i === active;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-6 w-6 flex-none items-center justify-center rounded-full text-[11px] font-black",
                current && "bg-progress text-on-accent",
                done && "bg-progress-soft text-progress",
                !current && !done && "bg-surface-2 text-text-tertiary",
              )}
            >
              {done ? "✓" : i + 1}
            </span>
            <span
              className={cn(
                "text-[12px] font-extrabold",
                current ? "text-text-primary" : "text-text-tertiary",
              )}
            >
              {label}
            </span>
            {i < STEP_LABELS.length - 1 && <span className="px-1 text-text-tertiary">›</span>}
          </li>
        );
      })}
    </ol>
  );
}
