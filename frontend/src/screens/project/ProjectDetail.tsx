/**
 * Project Detail (web-screens §C) — the workbench. One screen, three interchangeable
 * views of the same project (Table · Flow · Timeline) plus the right-side WP sheet
 * that opens from any view.
 *
 * View default is TABLE during F4 (cheapest/safest, built + verified first); it flips
 * to Flow-default once the Flow canvas is verified. The Flow view is React.lazy'd so
 * its heavy deps (React Flow + dagre) land in a separate chunk loaded only on demand.
 *
 * Principle 1: no view silently mutates the plan. WP/task edits are explicit submits
 * (WP sheet); a mid-flight WP add surfaces a replan proposal (reviewed here via the
 * reused ReplanReview); the Timeline's cross-day drag will emit a proposal too. The
 * proposal review state lives here so every view hands off to the one ReplanReview.
 */
import { Suspense, lazy, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { projectsApi } from "@/api";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/StatusPill";
import { ReplanReview } from "@/screens/roadmap/ReplanReview";
import { calmMessage } from "@/lib/apiError";
import { TableView } from "./TableView";
import { TimelineView } from "./TimelineView";
import { WorkPackageSheet } from "./WorkPackageSheet";
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
  { key: "table", label: "Table" },
  { key: "flow", label: "Flow" },
  { key: "timeline", label: "Timeline" },
];

export function ProjectDetail() {
  const { projectId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const view = (params.get("view") as ViewKind) || "table";
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
  // WorkPackageWithStatus from the shared cached list.
  const [selectedWpId, setSelectedWpId] = useState<string | null>(null);
  const selectedWp = workPackages.data?.find((w) => w.id === selectedWpId) ?? null;
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
      {/* --- Header (C.0) --- */}
      <header className="flex flex-col gap-3 border-b border-border px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-text-tertiary">
              {goal.data?.title ?? "Project"}
            </p>
            <div className="mt-0.5 flex items-center gap-2.5">
              <h1 className="truncate text-2xl font-black text-text-primary">{p.title}</h1>
              <StatusPill status={p.status === "completed" ? "completed" : "in_progress"} />
            </div>
          </div>
          <Button onClick={() => setAddOpen(true)}>
            <Plus size={16} /> Work package
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs font-bold text-text-secondary">
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
              <span className="h-2 w-32 overflow-hidden rounded-full bg-surface-2">
                <span
                  className="block h-full rounded-full bg-progress"
                  style={{ width: `${Math.round(p.progress.percent_done)}%` }}
                />
              </span>
              <span>
                {p.progress.tasks_done}/{p.progress.tasks_total} tasks ·{" "}
                {Math.round(p.progress.percent_done)}%
              </span>
            </span>
          )}
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

      {/* --- Active view --- */}
      <div className="min-h-0 flex-1 overflow-auto p-6">
        {view === "table" && <TableView projectId={projectId} onSelectWp={setSelectedWpId} />}
        {view === "flow" && (
          <Suspense
            fallback={
              <p className="p-6 text-sm font-bold text-text-tertiary">Loading flow canvas…</p>
            }
          >
            <FlowView projectId={projectId} onSelectWp={setSelectedWpId} />
          </Suspense>
        )}
        {view === "timeline" && (
          <TimelineView
            projectId={projectId}
            onProposal={(id) => {
              setNudge("A re-plan proposal was created — review it before it changes your plan.");
              setReviewId(id);
            }}
          />
        )}
      </div>

      {/* --- WP sheet (any view) --- */}
      <WorkPackageSheet
        projectId={projectId}
        workPackage={selectedWp}
        milestones={ms}
        onClose={() => setSelectedWpId(null)}
      />

      {/* --- Add WP (mid-flight → maybe a proposal) --- */}
      <AddWorkPackageSheet
        projectId={projectId}
        milestones={ms}
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={invalidate}
        onProposal={(id) => {
          setNudge("A replan proposal was created — review it before it changes your plan.");
          setReviewId(id);
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
