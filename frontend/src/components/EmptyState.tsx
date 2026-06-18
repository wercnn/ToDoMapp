/**
 * EmptyState — the shared "nothing here yet" treatment (design Principle 4: an empty
 * state should inform and invite, never look broken). A dashed, token-driven card
 * with an optional glyph, a line, a hint, and an optional CTA. Tokens only.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-[14px] border border-dashed border-border px-6 py-10 text-center",
        className,
      )}
    >
      {icon && <div className="text-text-tertiary">{icon}</div>}
      <p className="text-sm font-bold text-text-secondary">{title}</p>
      {hint && <p className="max-w-xs text-xs font-semibold text-text-tertiary">{hint}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
