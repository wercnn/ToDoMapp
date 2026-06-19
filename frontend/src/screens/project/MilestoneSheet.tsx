/**
 * Milestone panel — the right-side view opened when a milestone is created or
 * selected. A milestone groups work packages, so the panel is two lists: the work
 * packages currently in this milestone, and the ones that aren't (each flagged when
 * it already belongs to another milestone). Adding a flagged work package asks for
 * confirmation first, because a work package can only sit in one milestone — moving
 * it here removes it from the other (composite FK `ON DELETE SET NULL`, but here a
 * direct re-assign).
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus, X } from "lucide-react";
import type { MilestoneWithState, WorkPackageWithStatus } from "@api-types";
import { workPackagesApi } from "@/api";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/StatusPill";
import { calmMessage } from "@/lib/apiError";
import { projectQueryKeys } from "./useProjectData";

export function MilestoneSheet({
  projectId,
  milestone,
  milestones,
  workPackages,
  onClose,
}: {
  projectId: string;
  milestone: MilestoneWithState;
  milestones: MilestoneWithState[];
  workPackages: WorkPackageWithStatus[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  // A flagged add awaiting confirmation (the WP already sits in another milestone).
  const [pendingAdd, setPendingAdd] = useState<{ wp: WorkPackageWithStatus; fromTitle: string } | null>(
    null,
  );

  const msTitle = new Map(milestones.map((m) => [m.id, m.title]));
  const inThis = workPackages.filter((w) => w.milestone_id === milestone.id);
  const others = workPackages.filter((w) => w.milestone_id !== milestone.id);

  function invalidate() {
    for (const key of projectQueryKeys(projectId)) qc.invalidateQueries({ queryKey: key });
  }

  const assign = useMutation({
    mutationFn: ({ wpId, milestoneId }: { wpId: string; milestoneId: string | null }) =>
      workPackagesApi.update(wpId, { milestone_id: milestoneId }),
    onSuccess: () => {
      setError(null);
      setPendingAdd(null);
      invalidate();
    },
    onError: (e) => setError(calmMessage(e)),
  });

  function requestAdd(wp: WorkPackageWithStatus) {
    if (wp.milestone_id && wp.milestone_id !== milestone.id) {
      setPendingAdd({ wp, fromTitle: msTitle.get(wp.milestone_id) ?? "another milestone" });
      return;
    }
    assign.mutate({ wpId: wp.id, milestoneId: milestone.id });
  }

  return (
    <aside className="hidden w-[430px] flex-none flex-col border-l border-border bg-bg xl:flex">
      <header className="flex flex-none items-start gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-system">🚩 Milestone</p>
          <h2 className="mt-0.5 truncate text-lg font-black text-text-primary">{milestone.title}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] font-bold text-text-tertiary">
            <span>
              {milestone.wp_done}/{milestone.wp_total} work packages done
            </span>
            {milestone.projected_date && <span>· ~{milestone.projected_date}</span>}
            {milestone.achieved && <StatusPill status="completed" />}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close milestone panel"
          className="flex h-8 w-8 flex-none items-center justify-center rounded-[8px] text-text-tertiary hover:bg-surface-2 hover:text-text-primary"
        >
          <X size={17} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {error && (
          <p className="mb-3 rounded-[10px] bg-warning-soft px-3 py-2 text-xs font-bold text-warning">
            {error}
          </p>
        )}

        {/* --- In this milestone --- */}
        <h3 className="mb-2 text-[11px] font-extrabold uppercase tracking-wider text-text-tertiary">
          In this milestone · {inThis.length}
        </h3>
        {inThis.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-border px-3 py-4 text-xs font-semibold text-text-tertiary">
            No work packages yet. Add some from the list below.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {inThis.map((wp) => (
              <li
                key={wp.id}
                className="flex items-center gap-2 rounded-[10px] border border-border bg-surface-1 px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-text-primary">
                  {wp.title}
                </span>
                <StatusPill status={wp.derived_status} />
                <button
                  type="button"
                  aria-label="Remove from milestone"
                  title="Remove from this milestone"
                  disabled={assign.isPending}
                  onClick={() => assign.mutate({ wpId: wp.id, milestoneId: null })}
                  className="flex h-7 w-7 flex-none items-center justify-center rounded-[8px] text-text-tertiary hover:bg-surface-2 hover:text-warning disabled:opacity-40"
                >
                  <X size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* --- Available to add --- */}
        <h3 className="mb-2 mt-6 border-t border-border pt-4 text-[11px] font-extrabold uppercase tracking-wider text-text-tertiary">
          Add work packages
        </h3>
        {others.length === 0 ? (
          <p className="text-xs font-semibold text-text-tertiary">
            Every work package is already in this milestone.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {others.map((wp) => {
              const otherMs = wp.milestone_id ? msTitle.get(wp.milestone_id) : undefined;
              return (
                <li
                  key={wp.id}
                  className="flex items-center gap-2 rounded-[10px] border border-border bg-surface-1 px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-text-primary">
                    {wp.title}
                  </span>
                  {otherMs && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-bold text-warning"
                      title={`Already in “${otherMs}”`}
                    >
                      <AlertTriangle size={11} />
                      {otherMs}
                    </span>
                  )}
                  <StatusPill status={wp.derived_status} />
                  <button
                    type="button"
                    aria-label="Add to milestone"
                    title="Add to this milestone"
                    disabled={assign.isPending}
                    onClick={() => requestAdd(wp)}
                    className="flex h-7 w-7 flex-none items-center justify-center rounded-[8px] text-text-tertiary hover:bg-surface-2 hover:text-progress disabled:opacity-40"
                  >
                    <Plus size={15} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {pendingAdd && (
        <ConfirmMove
          wpTitle={pendingAdd.wp.title}
          fromTitle={pendingAdd.fromTitle}
          toTitle={milestone.title}
          busy={assign.isPending}
          onCancel={() => setPendingAdd(null)}
          onConfirm={() => assign.mutate({ wpId: pendingAdd.wp.id, milestoneId: milestone.id })}
        />
      )}
    </aside>
  );
}

/** Centered confirm dialog for moving a work package out of its current milestone. */
function ConfirmMove({
  wpTitle,
  fromTitle,
  toTitle,
  busy,
  onCancel,
  onConfirm,
}: {
  wpTitle: string;
  fromTitle: string;
  toTitle: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[var(--scrim)] backdrop-blur-[1px]" onClick={onCancel} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-sm rounded-[16px] border border-border bg-bg p-5 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-full bg-warning-soft text-warning">
            <AlertTriangle size={18} />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-black text-text-primary">Already in another milestone</h3>
            <p className="mt-1.5 text-sm font-semibold leading-relaxed text-text-secondary">
              <b className="text-text-primary">{wpTitle}</b> is already in{" "}
              <b className="text-text-primary">{fromTitle}</b>. Remove it from there and add it to{" "}
              <b className="text-text-primary">{toTitle}</b>?
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
            Keep where it is
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={busy}>
            {busy ? "Moving…" : "Move here"}
          </Button>
        </div>
      </div>
    </div>
  );
}
