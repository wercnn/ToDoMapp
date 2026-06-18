/**
 * DayDrawer — a single day's items + the direct day-level edits (web-screens §D):
 * confirm a proposed day, lock/unlock, add a task, reorder, defer, remove. All of
 * these are DELIBERATE user actions on the user's OWN day (invariant #5 permits
 * them); none is a silent plan rewrite, and there is NO cross-day drag here — moving
 * a task across days is the F4 Timeline and MUST emit a replan proposal, not a PATCH.
 *
 * Opening today's drawer records ⚡eng server-side (GET /days/{date} on today), so we
 * invalidate morning-brief/roadmap on close to reflect the streak/position.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Lock, Plus, Trash2, Unlock } from "lucide-react";
import type { DayView } from "@api-types";
import { daysApi, planItemsApi } from "@/api";
import { Button } from "@/components/ui/button";
import { StatusPill, type StatusKind } from "@/components/StatusPill";
import { calmMessage } from "@/lib/apiError";
import { cn } from "@/lib/utils";
import { formatDay } from "./dates";
import { useAddableTasks } from "./useAddableTasks";
import { Sheet } from "@/components/ui/sheet";

const DAY_PILL: Record<DayView["day"]["status"], StatusKind> = {
  proposed: "proposed",
  confirmed: "confirmed",
  completed: "completed",
  slipped: "slipped",
};

export function DayDrawer({
  date,
  today,
  onClose,
}: {
  date: string | null;
  today: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const day = useQuery({
    queryKey: ["day", date],
    queryFn: () => daysApi.get(date as string),
    enabled: date != null,
  });

  const view = day.data;
  const items = view?.items ?? [];
  const presentTaskIds = items.map((i) => i.item.task_id).filter((id): id is string => id != null);
  const addable = useAddableTasks(picking && date != null, presentTaskIds);

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ["day", date] });
    void qc.invalidateQueries({ queryKey: ["roadmap"] });
    void qc.invalidateQueries({ queryKey: ["morning-brief"] });
    void qc.invalidateQueries({ queryKey: ["addable-tasks"] });
  }

  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onMutate: () => setError(null),
    onError: (err) => setError(calmMessage(err)),
    onSuccess: () => invalidate(),
  });

  function handleClose() {
    setPicking(false);
    setError(null);
    onClose();
  }

  if (date == null) return null;

  const isLocked = view?.day.is_locked ?? false;
  const isProposed = view?.day.status === "proposed";
  const { weekday, rest } = formatDay(date);

  async function reorder(index: number, dir: -1 | 1) {
    const a = items[index];
    const b = items[index + dir];
    if (!a || !b) return;
    await planItemsApi.patch(a.item.id, { position: b.item.position });
    await planItemsApi.patch(b.item.id, { position: a.item.position });
  }

  return (
    <Sheet
      open
      onClose={handleClose}
      title={`${rest} · ${weekday}`}
      subtitle={date === today ? "Today" : undefined}
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {view && <StatusPill status={DAY_PILL[view.day.status]} />}
            {isLocked && <StatusPill status="locked" />}
          </div>
          {isProposed && (
            <Button
              size="sm"
              onClick={() => run.mutate(() => daysApi.confirm(date))}
              disabled={run.isPending}
            >
              Confirm day
            </Button>
          )}
        </div>
      }
    >
      {day.isLoading && <p className="text-sm font-bold text-text-tertiary">Loading…</p>}
      {day.isError && <p className="text-sm font-bold text-warning">{calmMessage(day.error)}</p>}

      {view && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-text-tertiary">
              {items.length} item{items.length === 1 ? "" : "s"}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => run.mutate(() => daysApi.setLock(date, !isLocked))}
              disabled={run.isPending}
            >
              {isLocked ? <Unlock size={14} /> : <Lock size={14} />}
              {isLocked ? "Unlock" : "Lock"}
            </Button>
          </div>

          {error && <p className="rounded-md bg-warning-soft px-3 py-2 text-xs font-semibold text-warning">{error}</p>}

          {items.length === 0 && (
            <p className="text-sm font-semibold text-text-tertiary">No tasks on this day yet.</p>
          )}

          <ul className="space-y-2">
            {items.map((entry, index) => (
              <li
                key={entry.item.id}
                className={cn(
                  "flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2.5",
                  entry.item.status === "deferred" && "opacity-50",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-text-primary">
                    {entry.task?.title ?? "Task"}
                  </p>
                  <p className="text-[11px] font-semibold text-text-tertiary">
                    {entry.item.status} · {entry.item.origin}
                  </p>
                </div>
                {!isLocked && entry.item.status === "planned" && (
                  <div className="flex flex-none items-center gap-0.5">
                    <IconBtn label="Move up" disabled={index === 0 || run.isPending} onClick={() => run.mutate(() => reorder(index, -1))}>
                      <ArrowUp size={14} />
                    </IconBtn>
                    <IconBtn label="Move down" disabled={index === items.length - 1 || run.isPending} onClick={() => run.mutate(() => reorder(index, 1))}>
                      <ArrowDown size={14} />
                    </IconBtn>
                    <IconBtn label="Defer" disabled={run.isPending} onClick={() => run.mutate(() => planItemsApi.patch(entry.item.id, { status: "deferred" }))}>
                      <span className="text-[11px] font-bold">Defer</span>
                    </IconBtn>
                    <IconBtn label="Remove" disabled={run.isPending} onClick={() => run.mutate(() => planItemsApi.remove(entry.item.id))}>
                      <Trash2 size={14} />
                    </IconBtn>
                  </div>
                )}
              </li>
            ))}
          </ul>

          {!isLocked && (
            <div className="border-t border-border pt-3">
              {!picking ? (
                <Button variant="outline" size="sm" onClick={() => setPicking(true)}>
                  <Plus size={14} /> Add task
                </Button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-text-tertiary">Add a task</p>
                  {addable.isLoading && <p className="text-xs font-semibold text-text-tertiary">Finding tasks…</p>}
                  {addable.data && addable.data.length === 0 && (
                    <p className="text-xs font-semibold text-text-tertiary">No unscheduled, unblocked tasks available.</p>
                  )}
                  <ul className="max-h-48 space-y-1 overflow-y-auto">
                    {addable.data?.map((t) => (
                      <li key={t.id}>
                        <button
                          className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-left text-sm font-semibold hover:bg-surface-2 disabled:opacity-50"
                          disabled={run.isPending}
                          onClick={() =>
                            run.mutate(async () => {
                              await daysApi.addItem(date, t.id);
                              setPicking(false);
                            })
                          }
                        >
                          <span className="truncate">{t.title}</span>
                          <Plus size={14} className="flex-none text-text-tertiary" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <Button variant="ghost" size="sm" onClick={() => setPicking(false)}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

function IconBtn({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md px-1.5 py-1 text-text-tertiary hover:bg-surface-2 hover:text-text-primary disabled:opacity-40"
    >
      {children}
    </button>
  );
}
