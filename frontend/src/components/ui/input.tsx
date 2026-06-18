/**
 * Input / Textarea — the shared text-field treatment (matches Login's inline
 * inputs): token-driven, focus ring on the progress accent. Kept tiny so every
 * onboarding form looks identical without each screen re-styling.
 */
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const base =
  "w-full rounded-[11px] border border-border bg-bg px-4 py-3 text-[15px] font-bold text-text-primary outline-none transition-colors placeholder:font-semibold placeholder:text-text-tertiary focus:border-progress disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(base, className)} {...props} />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(base, "min-h-[80px] resize-y leading-relaxed", className)} {...props} />
));
Textarea.displayName = "Textarea";

/** A labelled field wrapper — the small uppercase caption used across the app. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-extrabold uppercase tracking-wider text-text-tertiary">
        {label}
      </span>
      {children}
      {hint && <span className="text-[11px] font-semibold text-text-tertiary">{hint}</span>}
    </label>
  );
}
