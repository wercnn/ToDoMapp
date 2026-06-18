/**
 * Onboarding form fields that make the backend's estimation + time-fixed
 * invariants STRUCTURALLY hard to violate (per the F2 plan, point 5):
 *
 *  - Estimation is either hours OR difficulty, never both (Decision #13 → 422).
 *    `EstimateControl` is a segmented None | Hours | Difficulty selector; only the
 *    active mode contributes a value, so `estimationBody` can only ever emit ONE
 *    of the two fields. A request that carries both is unrepresentable here.
 *
 *  - Time-fixed is paired: `is_time_fixed` true ⇒ `fixed_date` set. `TimeFixedControl`
 *    reveals a REQUIRED date input only when the toggle is on, and `timeFixedBody`
 *    emits the pair atomically.
 *
 * The API body types (`Estimation`, `TimeFixed`) are the discriminated unions these
 * map onto, so the result drops straight into createWorkPackage / createTask.
 */
import type { DifficultyLevel } from "@api-types";
import type { Estimation, TimeFixed } from "@/api";
import { cn } from "@/lib/utils";

// ---- Estimation -------------------------------------------------------------
export type EstimateValue =
  | { mode: "none" }
  | { mode: "hours"; hours: string }
  | { mode: "difficulty"; difficulty: DifficultyLevel };

export const EMPTY_ESTIMATE: EstimateValue = { mode: "none" };

const DIFFICULTIES: DifficultyLevel[] = ["low", "mid", "high"];

/** A segmented-control button — active = filled accent, else quiet. */
function Seg({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-[8px] px-2.5 py-1.5 text-[12px] font-extrabold capitalize transition-colors",
        active ? "bg-progress text-on-accent" : "text-text-secondary hover:text-text-primary",
      )}
    >
      {children}
    </button>
  );
}

export function EstimateControl({
  value,
  onChange,
}: {
  value: EstimateValue;
  onChange: (v: EstimateValue) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="inline-flex w-fit rounded-[10px] border border-border bg-surface-2 p-0.5">
        <Seg active={value.mode === "none"} onClick={() => onChange({ mode: "none" })}>
          No estimate
        </Seg>
        <Seg
          active={value.mode === "hours"}
          onClick={() => onChange({ mode: "hours", hours: value.mode === "hours" ? value.hours : "" })}
        >
          Hours
        </Seg>
        <Seg
          active={value.mode === "difficulty"}
          onClick={() =>
            onChange({
              mode: "difficulty",
              difficulty: value.mode === "difficulty" ? value.difficulty : "mid",
            })
          }
        >
          Difficulty
        </Seg>
      </div>

      {value.mode === "hours" && (
        <input
          type="number"
          min={0.25}
          step={0.25}
          inputMode="decimal"
          placeholder="e.g. 2"
          value={value.hours}
          onChange={(e) => onChange({ mode: "hours", hours: e.target.value })}
          className="w-28 rounded-[9px] border border-border bg-bg px-3 py-2 text-sm font-bold outline-none focus:border-progress"
        />
      )}

      {value.mode === "difficulty" && (
        <div className="inline-flex w-fit gap-1">
          {DIFFICULTIES.map((d) => (
            <Seg
              key={d}
              active={value.difficulty === d}
              onClick={() => onChange({ mode: "difficulty", difficulty: d })}
            >
              {d}
            </Seg>
          ))}
        </div>
      )}
    </div>
  );
}

/** Build the API estimation fragment — structurally at most one field. */
export function estimationBody(v: EstimateValue): Estimation {
  if (v.mode === "hours") {
    const n = Number(v.hours);
    if (Number.isFinite(n) && n > 0) return { estimate_hours: n };
    return {};
  }
  if (v.mode === "difficulty") return { difficulty: v.difficulty };
  return {};
}

// ---- Time-fixed -------------------------------------------------------------
export type TimeFixedValue = { on: false } | { on: true; date: string };

export const EMPTY_TIME_FIXED: TimeFixedValue = { on: false };

export function TimeFixedControl({
  value,
  onChange,
}: {
  value: TimeFixedValue;
  onChange: (v: TimeFixedValue) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => onChange(value.on ? { on: false } : { on: true, date: "" })}
        className={cn(
          "inline-flex items-center gap-2 rounded-[9px] border px-3 py-2 text-xs font-extrabold transition-colors",
          value.on
            ? "border-border-strong bg-surface-3 text-text-primary"
            : "border-border bg-surface-2 text-text-secondary hover:text-text-primary",
        )}
      >
        <span aria-hidden>◆</span> Time-fixed
      </button>
      {value.on && (
        <input
          type="date"
          required
          value={value.date}
          onChange={(e) => onChange({ on: true, date: e.target.value })}
          className="rounded-[9px] border border-border bg-bg px-3 py-2 text-sm font-bold outline-none focus:border-progress"
        />
      )}
    </div>
  );
}

/**
 * Build the API time-fixed fragment. Returns null when the toggle is on but no
 * date is set yet — callers treat null as "not ready to submit" so the paired
 * invariant is never sent half-formed.
 */
export function timeFixedBody(v: TimeFixedValue): TimeFixed | null {
  if (!v.on) return { is_time_fixed: false };
  if (!v.date) return null;
  return { is_time_fixed: true, fixed_date: v.date };
}
