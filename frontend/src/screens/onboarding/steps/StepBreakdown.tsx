/**
 * A3 — Guided Breakdown (Work Packages → Tasks). The teaching moment: each WP and
 * task commits via its own POST the instant it's added (save-per-step), so the
 * list is the live server state. On resume it loads the existing WBS, so nothing
 * is rebuilt or duplicated. Estimate (either/or) and time-fixed (paired) come
 * from ItemForm, which makes the 422 validations structurally unreachable.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { projectsApi, tasksApi, workPackagesApi } from "@/api";
import { calmMessage } from "@/lib/apiError";
import { StatusPill } from "@/components/StatusPill";
import { StepHeader, InlineError, NavRow } from "./_chrome";
import { ItemForm, type ItemBody } from "./ItemForm";
import type { StepProps } from "../types";

export function StepBreakdown({ ctx }: StepProps) {
  const qc = useQueryClient();
  const projectId = ctx.projectId;
  const wps = useQuery({
    queryKey: ["onb-wps", projectId],
    queryFn: () => projectsApi.listWorkPackages(projectId!),
    enabled: !!projectId,
  });

  const addWp = useMutation({
    mutationFn: (body: ItemBody) => projectsApi.createWorkPackage(projectId!, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["onb-wps", projectId] }),
  });
  const delWp = useMutation({
    mutationFn: (id: string) => workPackagesApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["onb-wps", projectId] }),
  });

  const list = wps.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <StepHeader
        title="Break it into work packages and tasks"
        subtitle="A work package is a to-do list; tasks are the lines inside it. Add as many as you like — you can refine later."
      />

      <InlineError message={addWp.isError ? calmMessage(addWp.error) : null} />

      <div className="flex flex-col gap-3">
        {list.map((wp) => (
          <div key={wp.id} className="flex flex-col gap-3 rounded-[14px] border border-border bg-surface-2 p-4">
            <div className="flex items-center gap-2.5">
              <span className="text-[15px] font-extrabold">{wp.title}</span>
              <StatusPill status={wp.derived_status} />
              <button
                type="button"
                onClick={() => delWp.mutate(wp.id)}
                className="ml-auto text-[11px] font-bold text-text-tertiary hover:text-warning"
              >
                Delete
              </button>
            </div>
            <TasksSection wpId={wp.id} />
          </div>
        ))}

        {list.length === 0 && !wps.isLoading && (
          <p className="rounded-[12px] border border-dashed border-border px-4 py-5 text-center text-sm font-semibold text-text-tertiary">
            No work packages yet. Add your first below.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-extrabold uppercase tracking-wider text-text-tertiary">
          Add work package
        </span>
        <ItemForm
          placeholder="e.g. Design the landing page"
          submitLabel="+ Add work package"
          busy={addWp.isPending}
          onAdd={async (body) => {
            await addWp.mutateAsync(body);
          }}
        />
      </div>

      <NavRow
        onBack={ctx.back}
        primaryLabel="Continue →"
        onPrimary={ctx.next}
        primaryDisabled={list.length === 0}
      />
      {list.length === 0 && (
        <p className="-mt-3 text-right text-[11px] font-semibold text-text-tertiary">
          Add at least one work package to continue.
        </p>
      )}
    </div>
  );
}

function TasksSection({ wpId }: { wpId: string }) {
  const qc = useQueryClient();
  const tasks = useQuery({
    queryKey: ["onb-tasks", wpId],
    queryFn: () => workPackagesApi.listTasks(wpId),
  });
  const addTask = useMutation({
    mutationFn: (body: ItemBody) => workPackagesApi.createTask(wpId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["onb-tasks", wpId] }),
  });
  const delTask = useMutation({
    mutationFn: (id: string) => tasksApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["onb-tasks", wpId] }),
  });

  const list = tasks.data ?? [];

  return (
    <div className="flex flex-col gap-2 pl-1">
      {list.map((t) => (
        <div key={t.id} className="flex items-center gap-2 rounded-[9px] border border-border bg-bg px-3 py-2">
          <span className="text-[13px] font-bold text-text-primary">{t.title}</span>
          {t.is_time_fixed && <StatusPill status="time_fixed" />}
          {t.blocked && <StatusPill status="blocked" />}
          <button
            type="button"
            onClick={() => delTask.mutate(t.id)}
            className="ml-auto text-[11px] font-bold text-text-tertiary hover:text-warning"
          >
            ✕
          </button>
        </div>
      ))}
      {addTask.isError && <InlineError message={calmMessage(addTask.error)} />}
      <ItemForm
        placeholder="+ Add a task"
        submitLabel="Add task"
        busy={addTask.isPending}
        onAdd={async (body) => {
          await addTask.mutateAsync(body);
        }}
      />
    </div>
  );
}
