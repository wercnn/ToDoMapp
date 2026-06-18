/**
 * Table view (web-screens §C.3) — the WBS at a glance: rows = work packages,
 * expandable to their tasks. Read-only display (edits happen in the WP sheet);
 * selecting a row opens that sheet. Built first in F4 because it's the cheapest,
 * lowest-risk surface and proves the read shape.
 *
 * Data: `listWorkPackages` (full WP fields + derived_status) for the rows;
 * `listMilestones` for the milestone column; tasks load lazily per-WP on expand
 * (no upfront fan-out). The flow payload can't feed this — it omits milestone,
 * estimate, time-fixed and position.
 */
import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { MilestoneWithState, WorkPackageWithStatus } from "@api-types";
import { StatusPill } from "@/components/StatusPill";
import { useWorkPackages, useMilestones, useWorkPackageTasks } from "./useProjectData";
import { formatEstimate, taskStatusKind } from "./status";

export function TableView({
  projectId,
  onSelectWp,
}: {
  projectId: string;
  onSelectWp: (wpId: string) => void;
}) {
  const wps = useWorkPackages(projectId);
  const milestones = useMilestones(projectId);
  const msTitle = new Map((milestones.data ?? []).map((m: MilestoneWithState) => [m.id, m.title]));

  if (wps.isLoading)
    return <p className="p-6 text-sm font-bold text-text-tertiary">Loading work packages…</p>;
  if (wps.isError)
    return <p className="p-6 text-sm font-bold text-warning">Couldn’t load work packages.</p>;
  if (!wps.data?.length)
    return (
      <p className="p-6 text-sm font-bold text-text-tertiary">
        No work packages yet. Add one to start breaking down this project.
      </p>
    );

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border text-[10px] font-extrabold uppercase tracking-wider text-text-tertiary">
            <th className="px-3 py-2 font-extrabold">Work package</th>
            <th className="px-3 py-2 font-extrabold">Milestone</th>
            <th className="px-3 py-2 font-extrabold">Estimate</th>
            <th className="px-3 py-2 font-extrabold">Status</th>
          </tr>
        </thead>
        <tbody>
          {wps.data.map((wp) => (
            <WpRow
              key={wp.id}
              wp={wp}
              milestoneTitle={wp.milestone_id ? msTitle.get(wp.milestone_id) : undefined}
              onSelect={() => onSelectWp(wp.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WpRow({
  wp,
  milestoneTitle,
  onSelect,
}: {
  wp: WorkPackageWithStatus;
  milestoneTitle: string | undefined;
  onSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const tasks = useWorkPackageTasks(wp.id, expanded);

  return (
    <>
      <tr className="border-b border-border hover:bg-surface-1">
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <button
              aria-label={expanded ? "Collapse" : "Expand"}
              onClick={() => setExpanded((v) => !v)}
              className="flex-none rounded p-0.5 text-text-tertiary hover:text-text-primary"
            >
              {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            </button>
            <button
              onClick={onSelect}
              className="truncate text-left font-bold text-text-primary hover:text-progress"
            >
              {wp.title}
            </button>
            {wp.is_time_fixed && <StatusPill status="time_fixed" label="◆" className="px-2" />}
          </div>
        </td>
        <td className="px-3 py-2.5 text-xs font-semibold text-text-secondary">
          {milestoneTitle ?? <span className="text-text-tertiary">—</span>}
        </td>
        <td className="px-3 py-2.5 text-xs font-bold text-text-secondary">
          {formatEstimate(wp.estimate_hours, wp.difficulty)}
        </td>
        <td className="px-3 py-2.5">
          <StatusPill status={wp.derived_status} />
        </td>
      </tr>

      {expanded &&
        (tasks.isLoading ? (
          <tr>
            <td colSpan={4} className="px-3 py-2 pl-10 text-xs font-semibold text-text-tertiary">
              Loading tasks…
            </td>
          </tr>
        ) : (
          (tasks.data ?? []).map((t) => (
            <tr key={t.id} className="border-b border-border/60 bg-surface-1/40">
              <td className="px-3 py-2 pl-10">
                <span
                  className={
                    "text-[13px] font-semibold " +
                    (t.status === "done"
                      ? "text-text-tertiary line-through"
                      : "text-text-secondary")
                  }
                >
                  {t.title}
                </span>
              </td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-xs font-bold text-text-tertiary">
                {formatEstimate(t.estimate_hours, t.difficulty)}
              </td>
              <td className="px-3 py-2">
                <StatusPill status={taskStatusKind(t)} />
              </td>
            </tr>
          ))
        ))}
      {expanded && tasks.data?.length === 0 && (
        <tr>
          <td colSpan={4} className="px-3 py-2 pl-10 text-xs font-semibold text-text-tertiary">
            No tasks in this work package.
          </td>
        </tr>
      )}
    </>
  );
}
