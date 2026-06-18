/**
 * Work-Package Sheet (web-screens §C.4) — the right-side panel opened from any
 * Project Detail view. A work package IS a to-do list, so the sheet is that list:
 * the WP's editable header fields on top, its tasks below.
 *
 * Reuses the F3 Sheet primitive and the F2 discriminated-union form controls
 * (EstimateControl / TimeFixedControl) so an edit body structurally can't carry
 * both estimates or an unpaired time-fixed flag — the either/or + pairing 422s are
 * PREVENTED, not just caught. WP/task field edits are explicit form submits → direct
 * PATCH (Principle 1: explicit, never silent). `status`/`completed_at` are never sent
 * (complete/reopen own those).
 *
 * Scope note (F4): dependency add/remove lives on the FLOW canvas, which already
 * holds the full edge set; the sheet shows each task's derived `blocked` chip but
 * does not edit edges (that would need a second graph fetch here). In-sheet
 * dependency editing is a follow-up — see frontend-progress.md.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Trash2, Plus, ChevronUp, ChevronDown } from "lucide-react";
import type { MilestoneWithState, Task, WorkPackageWithStatus } from "@api-types";
import { tasksApi, workPackagesApi } from "@/api";
import type { TaskBody } from "@/api";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Field } from "@/components/ui/input";
import { StatusPill } from "@/components/StatusPill";
import { useCelebration } from "@/components/Celebration";
import { calmMessage } from "@/lib/apiError";
import {
  EstimateControl,
  TimeFixedControl,
  estimationBody,
  timeFixedBody,
  type EstimateValue,
  type TimeFixedValue,
} from "@/screens/onboarding/fields";
import { useWorkPackageTasks, projectQueryKeys } from "./useProjectData";
import { formatEstimate, taskStatusKind } from "./status";

function estimateValueOf(wp: { estimate_hours: string | null; difficulty: Task["difficulty"] }): EstimateValue {
  if (wp.estimate_hours != null) return { mode: "hours", hours: String(Number(wp.estimate_hours)) };
  if (wp.difficulty != null) return { mode: "difficulty", difficulty: wp.difficulty };
  return { mode: "none" };
}
function timeFixedValueOf(x: { is_time_fixed: boolean; fixed_date: string | null }): TimeFixedValue {
  return x.is_time_fixed && x.fixed_date ? { on: true, date: x.fixed_date } : { on: false };
}

export function WorkPackageSheet({
  projectId,
  workPackage,
  milestones,
  onClose,
}: {
  projectId: string;
  workPackage: WorkPackageWithStatus | null;
  milestones: MilestoneWithState[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const open = workPackage != null;
  const wpId = workPackage?.id ?? null;

  const tasks = useWorkPackageTasks(wpId, open);
  const [error, setError] = useState<string | null>(null);

  // --- WP header edit state (re-seeded whenever a different WP opens) ---
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [milestoneId, setMilestoneId] = useState<string | "">("");
  const [estimate, setEstimate] = useState<EstimateValue>({ mode: "none" });
  const [timeFixed, setTimeFixed] = useState<TimeFixedValue>({ on: false });

  useEffect(() => {
    if (!workPackage) return;
    setTitle(workPackage.title);
    setDescription(workPackage.description ?? "");
    setMilestoneId(workPackage.milestone_id ?? "");
    setEstimate(estimateValueOf(workPackage));
    setTimeFixed(timeFixedValueOf(workPackage));
    setError(null);
  }, [workPackage]);

  function invalidate() {
    for (const key of projectQueryKeys(projectId)) qc.invalidateQueries({ queryKey: key });
    if (wpId) qc.invalidateQueries({ queryKey: ["work-package", wpId, "tasks"] });
  }

  const saveWp = useMutation({
    mutationFn: () => {
      const tf = timeFixedBody(timeFixed);
      if (tf == null) throw new Error("Pick a date for the time-fixed work package.");
      return workPackagesApi.update(wpId as string, {
        title: title.trim(),
        description: description.trim() || null,
        milestone_id: milestoneId || null,
        ...estimationBody(estimate),
        ...tf,
      });
    },
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (e) => setError(calmMessage(e)),
  });

  const dirty = useMemo(() => {
    if (!workPackage) return false;
    return (
      title.trim() !== workPackage.title ||
      (description.trim() || null) !== (workPackage.description ?? null) ||
      (milestoneId || null) !== (workPackage.milestone_id ?? null) ||
      JSON.stringify(estimate) !== JSON.stringify(estimateValueOf(workPackage)) ||
      JSON.stringify(timeFixed) !== JSON.stringify(timeFixedValueOf(workPackage))
    );
  }, [workPackage, title, description, milestoneId, estimate, timeFixed]);

  const footer = workPackage && (
    <div className="flex items-center justify-between gap-3">
      <Button
        variant="ghost"
        className="text-warning"
        onClick={() => {
          if (!confirm("Delete this work package and its tasks?")) return;
          workPackagesApi
            .remove(workPackage.id)
            .then(() => {
              invalidate();
              onClose();
            })
            .catch((e) => setError(calmMessage(e)));
        }}
      >
        <Trash2 size={15} /> Delete
      </Button>
      <Button disabled={!dirty || saveWp.isPending} onClick={() => saveWp.mutate()}>
        {saveWp.isPending ? "Saving…" : "Save changes"}
      </Button>
    </div>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      width="max-w-lg"
      title={workPackage?.title ?? ""}
      subtitle={
        workPackage ? (
          <span className="inline-flex items-center gap-2">
            <StatusPill status={workPackage.derived_status} />
            {workPackage.is_time_fixed && <StatusPill status="time_fixed" />}
          </span>
        ) : undefined
      }
      footer={footer}
    >
      {error && (
        <p className="mb-3 rounded-[10px] bg-warning-soft px-3 py-2 text-xs font-bold text-warning">
          {error}
        </p>
      )}

      {/* --- WP header fields --- */}
      <div className="flex flex-col gap-4">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Milestone">
          <select
            value={milestoneId}
            onChange={(e) => setMilestoneId(e.target.value)}
            className="w-full rounded-[11px] border border-border bg-bg px-4 py-3 text-[15px] font-bold text-text-primary outline-none focus:border-progress"
          >
            <option value="">No milestone</option>
            {milestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Estimate">
          <EstimateControl value={estimate} onChange={setEstimate} />
        </Field>
        <Field label="Scheduling">
          <TimeFixedControl value={timeFixed} onChange={setTimeFixed} />
        </Field>
        <Field label="Description">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>

      {/* --- Task list --- */}
      <div className="mt-6 border-t border-border pt-4">
        <h3 className="mb-2 text-[11px] font-extrabold uppercase tracking-wider text-text-tertiary">
          Tasks
        </h3>
        {tasks.isLoading && (
          <p className="text-xs font-semibold text-text-tertiary">Loading tasks…</p>
        )}
        {tasks.data && tasks.data.length === 0 && (
          <p className="text-xs font-semibold text-text-tertiary">No tasks yet.</p>
        )}
        <ul className="flex flex-col gap-1.5">
          {tasks.data?.map((t, i) => (
            <TaskRow
              key={t.id}
              task={t}
              isFirst={i === 0}
              isLast={i === (tasks.data?.length ?? 0) - 1}
              onChanged={invalidate}
              onError={(m) => setError(m)}
            />
          ))}
        </ul>
        {wpId && (
          <AddTaskRow
            onAdd={(body) =>
              tasksApiCreate(wpId, body)
                .then(invalidate)
                .catch((e) => setError(calmMessage(e)))
            }
          />
        )}
      </div>
    </Sheet>
  );
}

function tasksApiCreate(wpId: string, body: TaskBody) {
  return workPackagesApi.createTask(wpId, body);
}

// ---- one task row -----------------------------------------------------------
function TaskRow({
  task,
  isFirst,
  isLast,
  onChanged,
  onError,
}: {
  task: Task & { blocked: boolean };
  isFirst: boolean;
  isLast: boolean;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const done = task.status === "done";
  const { celebrate } = useCelebration();
  const qc = useQueryClient();

  function run(p: Promise<unknown>) {
    p.then(onChanged).catch((e) => onError(calmMessage(e)));
  }

  // A completion/reopen here also moves today's plan, the path, and goal progress —
  // reads this sheet doesn't own. Keep them fresh (the project/WP lists go via onChanged).
  function crossInvalidate() {
    for (const key of [["morning-brief"], ["roadmap"], ["goal"]]) {
      void qc.invalidateQueries({ queryKey: key });
    }
  }

  function toggleComplete() {
    if (done) {
      tasksApi
        .reopen(task.id)
        .then(() => {
          onChanged();
          crossInvalidate();
        })
        .catch((e) => onError(calmMessage(e)));
      return;
    }
    // Same once-only contract as Home: celebrate iff the response carries the win.
    tasksApi
      .complete(task.id)
      .then((result) => {
        onChanged();
        crossInvalidate();
        if (result.milestone_achieved) {
          celebrate({
            milestoneId: result.milestone_achieved.milestone_id,
            title: result.milestone_achieved.title,
            bonusPoints: result.milestone_achieved.points_awarded,
          });
        }
      })
      .catch((e) => onError(calmMessage(e)));
  }

  return (
    <li className="flex items-center gap-2 rounded-[10px] border border-border bg-surface-1 px-2.5 py-2">
      <button
        aria-label={done ? "Reopen" : "Complete"}
        onClick={toggleComplete}
        className={
          done
            ? "flex h-5 w-5 flex-none items-center justify-center rounded-md bg-progress text-on-accent [animation:pop_200ms_ease-out]"
            : "flex h-5 w-5 flex-none items-center justify-center rounded-md border border-border-strong text-transparent hover:text-text-tertiary"
        }
      >
        <Check size={13} />
      </button>

      {editing ? (
        <Input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (title.trim() && title.trim() !== task.title)
              run(tasksApi.update(task.id, { title: title.trim() }));
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="h-8 flex-1 px-2 py-1 text-sm"
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className={
            "flex-1 truncate text-left text-sm font-bold " +
            (done ? "text-text-tertiary line-through" : "text-text-primary")
          }
        >
          {task.title}
        </button>
      )}

      <span className="flex-none text-[11px] font-bold text-text-tertiary">
        {formatEstimate(task.estimate_hours, task.difficulty)}
      </span>
      {task.is_time_fixed && <StatusPill status="time_fixed" />}
      {!done && <StatusPill status={taskStatusKind(task)} />}

      <div className="flex flex-none items-center">
        <button
          disabled={isFirst}
          aria-label="Move up"
          onClick={() => run(tasksApi.update(task.id, { position: task.position - 1 }))}
          className="p-1 text-text-tertiary hover:text-text-primary disabled:opacity-25"
        >
          <ChevronUp size={14} />
        </button>
        <button
          disabled={isLast}
          aria-label="Move down"
          onClick={() => run(tasksApi.update(task.id, { position: task.position + 1 }))}
          className="p-1 text-text-tertiary hover:text-text-primary disabled:opacity-25"
        >
          <ChevronDown size={14} />
        </button>
        <button
          aria-label="Delete task"
          onClick={() => confirm("Delete this task?") && run(tasksApi.remove(task.id))}
          className="p-1 text-text-tertiary hover:text-warning"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  );
}

// ---- add-task row -----------------------------------------------------------
function AddTaskRow({ onAdd }: { onAdd: (body: TaskBody) => void }) {
  const [title, setTitle] = useState("");
  function submit() {
    const t = title.trim();
    if (!t) return;
    onAdd({ title: t });
    setTitle("");
  }
  return (
    <div className="mt-2 flex items-center gap-2">
      <Input
        value={title}
        placeholder="Add a task…"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        className="h-9 flex-1 px-3 py-1.5 text-sm"
      />
      <Button variant="ghost" disabled={!title.trim()} onClick={submit}>
        <Plus size={15} /> Add
      </Button>
    </div>
  );
}
