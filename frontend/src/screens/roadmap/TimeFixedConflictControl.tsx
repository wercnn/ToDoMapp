/**
 * One time-fixed conflict's resolution control — the structural heart of Principle 1
 * in F3. A pinned commitment at risk is NEVER auto-moved; the user must choose
 * prioritize / descope / renegotiate. `renegotiate` requires a new date, and this
 * control only emits a `renegotiate` decision once that date is set — so the parent
 * (and buildApproveEdits) can never see a dateless renegotiate. An unresolved
 * conflict reports `undefined`, which keeps the Approve button disabled.
 */
import { useState } from "react";
import type { TimeFixedConflict } from "@api-types";
import type { TimeFixedDecision } from "@/lib/buildApproveEdits";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Choice = TimeFixedDecision["choice"];

const COPY: Record<Choice, { label: string; hint: string }> = {
  prioritize: { label: "Prioritize", hint: "Keep the commitment on its date; absorb the overload." },
  descope: { label: "Descope", hint: "Drop it from the plan (no penalty); reschedule later." },
  renegotiate: { label: "Renegotiate", hint: "Commit to a new date instead." },
};

export function TimeFixedConflictControl({
  conflict,
  onChange,
}: {
  conflict: TimeFixedConflict;
  onChange: (decision: TimeFixedDecision | undefined) => void;
}) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [newDate, setNewDate] = useState("");

  function select(next: Choice) {
    setChoice(next);
    if (next === "prioritize") onChange({ choice: "prioritize" });
    else if (next === "descope") onChange({ choice: "descope" });
    else onChange(newDate ? { choice: "renegotiate", new_fixed_date: newDate } : undefined);
  }

  function setDate(value: string) {
    setNewDate(value);
    if (choice === "renegotiate") {
      onChange(value ? { choice: "renegotiate", new_fixed_date: value } : undefined);
    }
  }

  return (
    <div className="rounded-lg border border-warning/40 bg-warning-soft/30 p-3">
      <div className="flex items-start gap-2">
        <span aria-hidden className="text-warning">◆</span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-text-primary">
            Time-fixed conflict{conflict.fixed_date ? ` · ${conflict.fixed_date}` : ""}
          </p>
          <p className="mt-0.5 text-xs font-semibold text-text-tertiary">{conflict.reason}</p>
        </div>
      </div>

      <div className="mt-3 grid gap-1.5">
        {conflict.options.map((opt) => (
          <button
            key={opt}
            onClick={() => select(opt)}
            className={cn(
              "flex items-start gap-2 rounded-md border px-3 py-2 text-left",
              choice === opt ? "border-system bg-system-soft" : "border-border bg-surface-1 hover:bg-surface-2",
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full border-2",
                choice === opt ? "border-system" : "border-border-strong",
              )}
              aria-hidden
            >
              {choice === opt && <span className="h-2 w-2 rounded-full bg-system" />}
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-extrabold text-text-primary">{COPY[opt].label}</span>
              <span className="block text-[11px] font-semibold text-text-tertiary">{COPY[opt].hint}</span>
            </span>
          </button>
        ))}
      </div>

      {choice === "renegotiate" && (
        <label className="mt-2 block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-tertiary">
            New committed date (required)
          </span>
          <Input type="date" value={newDate} onChange={(e) => setDate(e.target.value)} />
        </label>
      )}
    </div>
  );
}
