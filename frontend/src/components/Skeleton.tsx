/**
 * Skeleton — a token-driven placeholder block for the primary reads. Uses Tailwind's
 * `animate-pulse`; the global prefers-reduced-motion rule (styles/index.css) collapses
 * the pulse to a static block, so reduced-motion users still see the layout, calmly.
 */
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-2", className)} aria-hidden />;
}
