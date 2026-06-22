/**
 * Project Detail (web-screens §C) — the workbench. One screen, three interchangeable
 * views of the same project (Flow · Timeline · Table) plus the right-side WP panel
 * that opens from any view.
 *
 * View default is Flow. The Flow view is React.lazy'd so its heavy deps
 * (React Flow + dagre) land in a separate chunk loaded only on demand.
 *
 * Principle 1: no view silently mutates the plan. WP/task edits are explicit submits
 * (WP panel); replanning is a manual proposal reviewed here via the reused
 * ReplanReview. The proposal review state lives here so every view hands off to
 * the one ReplanReview.
 */
import { Suspense, lazy, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Flag, Plus } from "lucide-react";
import { projectsApi } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/StatusPill";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ReplanReview } from "@/screens/roadmap/ReplanReview";
import { calmMessage } from "@/lib/apiError";
import { cn } from "@/lib/utils";
import { TableView } from "./TableView";
import { TimelineView } from "./TimelineView";
import { WorkPackageSheet } from "./WorkPackageSheet";
import { MilestoneSheet } from "./MilestoneSheet";
import { AddWorkPackageSheet } from "./AddWorkPackageSheet";
import {
  useProject,
  useParentGoal,
  useMilestones,
  useWorkPackages,
  projectQueryKeys,
} from "./useProjectData";

const FlowView = lazy(() => import("./FlowView"));

type ViewKind = "table" | "flow" | "timeline";
const VIEWS: { key: ViewKind; label: string }[] = [
  { key: "flow", label: "Flow" },
  { key: "timeline", label: "Timeline" },
  { key: "table", label: "Table" },
];

export function ProjectDetail() {
  const { projectId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const view = (params.get("view") as ViewKind) || "flow";
  const setView = (v: ViewKind) => setParams((p) => {
    p.set("view", v);
    return p;
  });

  const qc = useQueryClient();
  const project = useProject(projectId);
  const goal = useParentGoal(project.data?.goal_id);
  const milestones = useMilestones(projectId);
  const workPackages = useWorkPackages(projectId);

  // Selection is by id so every view (Table row, Flow node) resolves to the same
  // WorkPackageWithStatus from the shared cached list. A WP and a milestone are
  // mutually-exclusive right-panel views.
  const [selectedWpId, setSelectedWpId] = useState<string | null>(null);
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string | null>(null);
  const selectedWp = workPackages.data?.find((w) => w.id === selectedWpId) ?? null;
  const selectedMilestone = milestones.data?.find((m) => m.id === selectedMilestoneId) ?? null;
  const selectWp = (id: string) => {
    setSelectedMilestoneId(null);
    setSelectedWpId(id);
  };
  const selectMilestone = (id: string) => {
    setSelectedWpId(null);
    setSelectedMilestoneId(id);
  };
  const [addOpen, setAddOpen] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [nudge, setNudge] = useState<string | null>(null);

  function invalidate() {
    for (const key of projectQueryKeys(projectId)) qc.invalidateQueries({ queryKey: key });
  }

  if (project.isLoading)
    return <p className="p-8 text-sm font-bold text-text-tertiary">Loading project…</p>;
  if (project.isError || !project.data)
    return <p className="p-8 text-sm font-bold text-warning">Couldn’t load this project.</p>;

  const p = project.data;
  const ms = milestones.data ?? [];

  return (
    <div className="flex h-full flex-col">
      {/* --- Header (C.0) — thin, single horizontal row --- */}
      <header className="flex flex-col gap-2.5 border-b border-border px-6 py-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-text-tertiary">
              {goal.data?.title ?? "Project"}
            </p>
            <div className="flex items-center gap-2.5">
              <h1 className="truncate text-xl font-black text-text-primary">{p.title}</h1>
              <StatusPill status={p.status === "completed" ? "completed" : "in_progress"} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs font-bold text-text-secondary">
            <CapacityEditor
              projectId={projectId}
              value={Number(p.capacity_hours_per_day)}
              onSaved={invalidate}
              onError={setNudge}
            />
            {p.target_end_date && (
              <span>
                <span className="text-text-tertiary">Target end</span> {p.target_end_date}
              </span>
            )}
            {"progress" in p && (
              <span className="flex items-center gap-2">
                <span className="h-2 w-24 overflow-hidden rounded-full bg-surface-2">
                  <span
                    className="block h-full rounded-full bg-progress"
                    style={{ width: `${Math.round(p.progress.percent_done)}%` }}
                  />
                </span>
                <span>
                  {p.progress.tasks_done}/{p.progress.tasks_total} · {Math.round(p.progress.percent_done)}%
                </span>
              </span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <AddMilestoneButton
              projectId={projectId}
              onCreated={(id) => {
                invalidate();
                selectMilestone(id);
              }}
              onError={setNudge}
            />
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus size={15} /> Work package
            </Button>
          </div>
        </div>

        {/* --- View toggle (the key control) --- */}
        <div className="inline-flex w-fit rounded-[11px] border border-border bg-surface-1 p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={
                "rounded-[9px] px-4 py-1.5 text-[13px] font-extrabold transition-colors " +
                (view === v.key
                  ? "bg-surface-3 text-text-primary"
                  : "text-text-secondary hover:text-text-primary")
              }
            >
              {v.label}
            </button>
          ))}
        </div>
      </header>

      {nudge && (
        <p className="border-b border-border bg-system-soft px-6 py-2 text-xs font-bold text-system">
          {nudge}
        </p>
      )}

      {/* --- Active view + inline WP panel --- */}
      <div className="flex min-h-0 flex-1">
        <div className={cn("min-w-0 flex-1 overflow-auto", view === "flow" ? "p-0" : "p-6")}>
          {view === "table" && (
            <TableView projectId={projectId} onSelectWp={selectWp} onSelectMilestone={selectMilestone} />
          )}
          {view === "flow" && (
            <ErrorBoundary
              fallback={
                <p className="p-6 text-sm font-bold text-warning">
                  Couldn’t load the flow canvas. Check your connection and try the Table view.
                </p>
              }
            >
              <Suspense
                fallback={
                  <p className="p-6 text-sm font-bold text-text-tertiary">Loading flow canvas…</p>
                }
              >
                <FlowView projectId={projectId} onSelectWp={selectWp} />
              </Suspense>
            </ErrorBoundary>
          )}
          {view === "timeline" && (
            <TimelineView
              projectId={projectId}
              onProposal={(id) => {
                setNudge("Review the replan proposal before it changes your plan.");
                setReviewId(id);
              }}
            />
          )}
        </div>

        {selectedMilestone ? (
          <MilestoneSheet
            projectId={projectId}
            milestone={selectedMilestone}
            milestones={ms}
            workPackages={workPackages.data ?? []}
            onClose={() => setSelectedMilestoneId(null)}
          />
        ) : (
          <WorkPackageSheet
            projectId={projectId}
            workPackage={selectedWp}
            milestones={ms}
            onClose={() => setSelectedWpId(null)}
          />
        )}
      </div>

      {/* --- Add WP (direct create; Replan stays manual) --- */}
      <AddWorkPackageSheet
        projectId={projectId}
        milestones={ms}
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={() => {
          invalidate();
          setNudge("Work package added. Use Replan when you want to reorganize the roadmap.");
        }}
      />

      {/* --- Proposal review (shared handoff for every view) --- */}
      <ReplanReview proposalId={reviewId} onClose={() => setReviewId(null)} />
    </div>
  );
}

/** Inline-editable capacity (hours/day) — a direct PATCH (project capacity, not the plan). */
function CapacityEditor({
  projectId,
  value,
  onSaved,
  onError,
}: {
  projectId: string;
  value: number;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const save = useMutation({
    mutationFn: (hours: number) =>
      projectsApi.update(projectId, { capacity_hours_per_day: hours }),
    onSuccess: onSaved,
    onError: (e) => onError(calmMessage(e)),
  });

  return (
    <span className="flex items-center gap-1.5">
      <span className="text-text-tertiary">Capacity</span>
      <input
        type="number"
        min={0.5}
        step={0.5}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(draft);
          if (Number.isFinite(n) && n > 0 && n !== value) save.mutate(n);
          else setDraft(String(value));
        }}
        className="w-16 rounded-[8px] border border-border bg-bg px-2 py-1 text-xs font-bold outline-none focus:border-progress"
      />
      <span className="text-text-tertiary">h/day</span>
    </span>
  );
}

/**
 * Add-milestone affordance in the project header (system/lilac). A milestone is a
 * project-level landmark — it is intentionally NOT rendered on the flow canvas.
 * Opens a tiny inline form; on submit creates the milestone and refreshes the lists.
 */
function AddMilestoneButton({
  projectId,
  onCreated,
  onError,
}: {
  projectId: string;
  onCreated: (milestoneId: string) => void;
  onError: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const create = useMutation({
    mutationFn: () => projectsApi.createMilestone(projectId, { title: title.trim() }),
    onSuccess: (milestone) => {
      setTitle("");
      setOpen(false);
      onCreated(milestone.id);
    },
    onError: (e) => onError(calmMessage(e)),
  });

  return (
    <div className="relative">
      <Button size="sm" variant="system" onClick={() => setOpen((o) => !o)}>
        <Flag size={14} /> Add milestone
      </Button>
      {open && (
        <div className="absolute right-0 top-11 z-40 w-[260px] rounded-[12px] border border-border bg-bg p-3 shadow-xl">
          <p className="mb-2 text-[11px] font-extrabold uppercase tracking-wider text-text-tertiary">
            New milestone
          </p>
          <Input
            autoFocus
            value={title}
            placeholder="Milestone title…"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && title.trim()) create.mutate();
              if (e.key === "Escape") setOpen(false);
            }}
            className="h-9 px-3 py-1.5 text-sm"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="system"
              disabled={!title.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? "Adding…" : "Add"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
