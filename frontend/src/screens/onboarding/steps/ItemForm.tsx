/**
 * The add-a-WP / add-a-task form used in A3. Collects a title plus the
 * structurally-safe estimate (either/or) and time-fixed (paired) controls, and
 * emits a body that drops straight into createWorkPackage / createTask.
 *
 * The emitted shape `{ title } & Estimation & TimeFixed` is assignable to both
 * WorkPackageBody and TaskBody (their extra fields are optional), so one form
 * serves both levels.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  EstimateControl,
  TimeFixedControl,
  estimationBody,
  timeFixedBody,
  EMPTY_ESTIMATE,
  EMPTY_TIME_FIXED,
  type EstimateValue,
  type TimeFixedValue,
} from "../fields";
import type { Estimation, TimeFixed } from "@/api";

export type ItemBody = { title: string } & Estimation & TimeFixed;

export function ItemForm({
  placeholder,
  submitLabel,
  busy,
  onAdd,
}: {
  placeholder: string;
  submitLabel: string;
  busy?: boolean;
  onAdd: (body: ItemBody) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [est, setEst] = useState<EstimateValue>(EMPTY_ESTIMATE);
  const [timeFixed, setTimeFixed] = useState<TimeFixedValue>(EMPTY_TIME_FIXED);

  const tf = timeFixedBody(timeFixed); // null while time-fixed is on but no date yet
  const canAdd = title.trim().length > 0 && tf !== null && !busy;

  async function add() {
    if (!canAdd || tf === null) return;
    await onAdd({ title: title.trim(), ...estimationBody(est), ...tf });
    setTitle("");
    setEst(EMPTY_ESTIMATE);
    setTimeFixed(EMPTY_TIME_FIXED);
  }

  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-dashed border-border bg-bg p-3">
      <Input
        placeholder={placeholder}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void add();
          }
        }}
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <EstimateControl value={est} onChange={setEst} />
          <TimeFixedControl value={timeFixed} onChange={setTimeFixed} />
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={() => void add()} disabled={!canAdd}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
