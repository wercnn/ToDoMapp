/**
 * StatusPill — the single component for every domain status, so a state looks
 * identical everywhere (flow, tables, roadmap, day cards). Glyph + color + label,
 * never color alone (design language §4 accessibility rule). Soft-bg chip style
 * from the Earned Momentum status tokens.
 */
import { cn } from "@/lib/utils";

export type StatusKind =
  | "open"
  | "in_progress"
  | "blocked"
  | "done"
  | "proposed"
  | "confirmed"
  | "completed"
  | "slipped"
  | "time_fixed"
  | "locked"
  | "pending";

interface PillSpec {
  label: string;
  glyph: string;
  /** tailwind classes for fg + soft bg (tokens only). */
  className: string;
  dashed?: boolean;
}

const SPECS: Record<StatusKind, PillSpec> = {
  open: { label: "Open", glyph: "○", className: "text-text-secondary bg-surface-2" },
  in_progress: { label: "In progress", glyph: "●", className: "text-info bg-info-soft" },
  blocked: { label: "Blocked", glyph: "△", className: "text-warning bg-warning-soft" },
  done: { label: "Done", glyph: "✓", className: "text-progress bg-progress-soft" },
  completed: { label: "Completed", glyph: "✓", className: "text-progress bg-progress-soft" },
  proposed: { label: "Proposed", glyph: "◇", className: "text-system bg-system-soft" },
  confirmed: { label: "Confirmed", glyph: "●", className: "text-text-primary bg-surface-3" },
  slipped: {
    label: "Slipped",
    glyph: "◌",
    className: "text-text-secondary bg-transparent border border-dashed border-border-strong",
    dashed: true,
  },
  time_fixed: {
    label: "Time-fixed",
    glyph: "◆",
    className: "text-text-secondary bg-transparent border border-border-strong",
  },
  locked: { label: "Locked", glyph: "🔒", className: "text-text-secondary bg-surface-2" },
  pending: { label: "Pending", glyph: "◇", className: "text-system bg-system-soft" },
};

export function StatusPill({
  status,
  label,
  className,
}: {
  status: StatusKind;
  label?: string;
  className?: string;
}) {
  const spec = SPECS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold leading-none",
        spec.className,
        className,
      )}
    >
      <span aria-hidden>{spec.glyph}</span>
      {label ?? spec.label}
    </span>
  );
}
