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
import { useMemo, useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { MilestoneWithState, WorkPackageWithStatus } from "@api-types";
import { StatusPill } from "@/components/StatusPill";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
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
  const [search, setSearch] = useState("");
  const [openOnly, setOpenOnly] = useState(false);
  const [groupByMilestone, setGroupByMilestone] = useState(false);
  const [sort, setSort] = useState<"position" | "title" | "status">("position");

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...(wps.data ?? [])]
      .filter((wp) => !openOnly || wp.derived_status !== "done")
      .filter((wp) => !query || wp.title.toLowerCase().includes(query))
      .sort((a, b) => {
        if (sort === "title") return a.title.localeCompare(b.title);
        if (sort === "status") return a.derived_status.localeCompare(b.derived_status);
        return a.position - b.position;
      });
  }, [wps.data, openOnly, search, sort]);

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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter work packages"
          className="h-9 max-w-[260px] px-3 py-2 text-sm"
        />
        <label className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-border bg-surface-1 px-3 text-xs font-extrabold text-text-secondary">
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(event) => setOpenOnly(event.target.checked)}
            className="accent-[var(--accent-progress)]"
          />
          Open only
        </label>
        <label className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-border bg-surface-1 px-3 text-xs font-extrabold text-text-secondary">
          <input
            type="checkbox"
            checked={groupByMilestone}
            onChange={(event) => setGroupByMilestone(event.target.checked)}
            className="accent-[var(--accent-progress)]"
          />
          Group by milestone
        </label>
      </div>

      <div className="overflow-x-auto rounded-[14px] border border-border">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border text-[10px] font-extrabold uppercase tracking-wider text-text-tertiary">
            <SortTh active={sort === "title"} onClick={() => setSort("title")}>Work package</SortTh>
            <th className="px-3 py-2 font-extrabold">Milestone</th>
            <th className="px-3 py-2 font-extrabold">Estimate</th>
            <th className="px-3 py-2 font-extrabold">Time-fixed</th>
            <SortTh active={sort === "position"} onClick={() => setSort("position")}>Position</SortTh>
            <SortTh active={sort === "status"} onClick={() => setSort("status")}>Status</SortTh>
          </tr>
        </thead>
        <tbody>
          {renderRows(rows, groupByMilestone, msTitle, onSelectWp)}
        </tbody>
      </table>
      {rows.length === 0 && (
        <p className="px-3 py-8 text-center text-sm font-semibold text-text-tertiary">No matching rows.</p>
      )}
      </div>
    </div>
  );
}

function SortTh({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <th className="px-3 py-2 font-extrabold">
      <button
        type="button"
        onClick={onClick}
        className={cn("text-[10px] font-extrabold uppercase tracking-wider", active ? "text-progress" : "text-text-tertiary")}
      >
        {children}
      </button>
    </th>
  );
}

function renderRows(
  rows: WorkPackageWithStatus[],
  grouped: boolean,
  msTitle: Map<string, string>,
  onSelectWp: (wpId: string) => void,
) {
  if (!grouped) {
    return rows.map((wp) => (
      <WpRow
        key={wp.id}
        wp={wp}
        milestoneTitle={wp.milestone_id ? msTitle.get(wp.milestone_id) : undefined}
        onSelect={() => onSelectWp(wp.id)}
      />
    ));
  }
  const groups = new Map<string, WorkPackageWithStatus[]>();
  for (const wp of rows) {
    const key = wp.milestone_id ? msTitle.get(wp.milestone_id) ?? "Milestone" : "No milestone";
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(wp);
  }
  return [...groups.entries()].flatMap(([title, group]) => [
    <tr key={`group-${title}`} className="border-b border-border bg-surface-2/70">
      <td colSpan={6} className="px-3 py-2 text-xs font-black uppercase tracking-wider text-system">
        {title}
      </td>
    </tr>,
    ...group.map((wp) => (
      <WpRow
        key={wp.id}
        wp={wp}
        milestoneTitle={wp.milestone_id ? msTitle.get(wp.milestone_id) : undefined}
        onSelect={() => onSelectWp(wp.id)}
      />
    )),
  ]);
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
          </div>
        </td>
        <td className="px-3 py-2.5 text-xs font-semibold text-text-secondary">
          {milestoneTitle ?? <span className="text-text-tertiary">—</span>}
        </td>
        <td className="px-3 py-2.5 text-xs font-bold text-text-secondary">
          {formatEstimate(wp.estimate_hours, wp.difficulty)}
        </td>
        <td className="px-3 py-2.5 text-xs font-bold text-text-secondary">
          {wp.is_time_fixed ? <StatusPill status="time_fixed" label={wp.fixed_date ?? "Pinned"} /> : <span className="text-text-tertiary">—</span>}
        </td>
        <td className="px-3 py-2.5 font-mono text-xs font-bold text-text-tertiary">{wp.position}</td>
        <td className="px-3 py-2.5">
          <StatusPill status={wp.derived_status} />
        </td>
      </tr>

      {expanded &&
        (tasks.isLoading ? (
          <tr>
            <td colSpan={6} className="px-3 py-2 pl-10 text-xs font-semibold text-text-tertiary">
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
              <td className="px-3 py-2 text-xs font-bold text-text-tertiary">
                {t.is_time_fixed ? <StatusPill status="time_fixed" label={t.fixed_date ?? "Pinned"} /> : "—"}
              </td>
              <td className="px-3 py-2 font-mono text-xs font-bold text-text-tertiary">{t.position}</td>
              <td className="px-3 py-2">
                <StatusPill status={taskStatusKind(t)} />
              </td>
            </tr>
          ))
        ))}
      {expanded && tasks.data?.length === 0 && (
        <tr>
          <td colSpan={6} className="px-3 py-2 pl-10 text-xs font-semibold text-text-tertiary">
            No tasks in this work package.
          </td>
        </tr>
      )}
    </>
  );
}
