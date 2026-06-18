/**
 * Grouping step: order work packages, assign them to milestones, and add key
 * finish-before dependencies.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, GripVertical, Sparkles } from "lucide-react";
import { dependenciesApi, projectsApi, workPackagesApi } from "@/api";
import type { WorkPackageWithStatus } from "@api-types";
import { calmMessage } from "@/lib/apiError";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { StepHeader, NavRow } from "./_chrome";
import type { StepProps } from "../types";

interface DrawnEdge {
  predecessor_wp_id: string;
  successor_wp_id: string;
}

export function StepGroup({ ctx }: StepProps) {
  const qc = useQueryClient();
  const projectId = ctx.projectId;
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);

  const wps = useQuery({
    queryKey: ["onb-wps", projectId],
    queryFn: () => projectsApi.listWorkPackages(projectId!),
    enabled: !!projectId,
  });
  const milestones = useQuery({
    queryKey: ["onb-milestones", projectId],
    queryFn: () => projectsApi.listMilestones(projectId!),
    enabled: !!projectId,
  });
  const wpList = wps.data ?? [];
  const msList = milestones.data ?? [];

  const assign = useMutation({
    mutationFn: ({ wpId, milestoneId }: { wpId: string; milestoneId: string | null }) =>
      workPackagesApi.update(wpId, { milestone_id: milestoneId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["onb-wps", projectId] }),
  });
  const reorder = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id, index) => workPackagesApi.update(id, { position: index })));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["onb-wps", projectId] }),
  });

  const suggested = useMemo(() => suggestOrder(wpList).map((wp) => wp.id), [wpList]);
  const current = wpList.map((wp) => wp.id);
  const suggestionApplies =
    !suggestionDismissed &&
    suggested.length > 1 &&
    suggested.some((id, index) => id !== current[index]);

  const persistMove = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    reorder.mutate(moveBefore(current, fromId, toId));
  };
  const nudge = (id: string, direction: -1 | 1) => {
    const index = current.indexOf(id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return;
    const next = [...current];
    [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
    reorder.mutate(next);
  };

  return (
    <div className="flex flex-col gap-6">
      <StepHeader
        title="Group the work"
        subtitle="Put work packages in a sensible order, assign each to a milestone, and add only the dependencies that truly matter."
      />

      {suggestionApplies && (
        <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-system/40 bg-system-soft p-3">
          <Sparkles size={16} className="text-system" />
          <span className="min-w-0 flex-1 text-xs font-extrabold text-system">
            Suggested ordering puts time-fixed work and easier setup steps earlier.
          </span>
          <Button size="sm" variant="system" onClick={() => reorder.mutate(suggested)}>
            Accept
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSuggestionDismissed(true)}>
            Dismiss
          </Button>
        </div>
      )}

      <section className="flex flex-col gap-3">
        <span className="text-[11px] font-extrabold uppercase tracking-wider text-text-tertiary">
          Work package order
        </span>
        <div className="flex flex-col gap-2">
          {wpList.map((wp, index) => (
            <div
              key={wp.id}
              draggable
              onDragStart={() => setDraggedId(wp.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (draggedId) persistMove(draggedId, wp.id);
                setDraggedId(null);
              }}
              onDragEnd={() => setDraggedId(null)}
              className={cn(
                "grid grid-cols-[28px_minmax(0,1fr)_170px_68px] items-center gap-2 rounded-[12px] border border-border bg-surface-2 px-3 py-2.5",
                draggedId === wp.id && "opacity-60",
              )}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-[8px] text-text-tertiary">
                <GripVertical size={16} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-extrabold text-text-primary">{wp.title}</p>
                <p className="text-[11px] font-semibold text-text-tertiary">
                  {wp.estimate_hours ? `${Number(wp.estimate_hours).toFixed(1)}h` : wp.difficulty ?? "unestimated"}
                  {wp.is_time_fixed && wp.fixed_date ? ` · pinned ${wp.fixed_date}` : ""}
                </p>
              </div>
              <select
                value={wp.milestone_id ?? ""}
                onChange={(event) => assign.mutate({ wpId: wp.id, milestoneId: event.target.value || null })}
                className="min-w-0 rounded-[8px] border border-border bg-bg px-2 py-1.5 text-xs font-bold outline-none focus:border-progress"
              >
                <option value="">No milestone</option>
                {msList.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
              <div className="flex justify-end gap-1">
                <button
                  type="button"
                  disabled={index === 0 || reorder.isPending}
                  onClick={() => nudge(wp.id, -1)}
                  className="flex h-7 w-7 items-center justify-center rounded-[8px] text-text-tertiary hover:bg-bg hover:text-progress disabled:opacity-35"
                  title="Move up"
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  disabled={index === wpList.length - 1 || reorder.isPending}
                  onClick={() => nudge(wp.id, 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-[8px] text-text-tertiary hover:bg-bg hover:text-progress disabled:opacity-35"
                  title="Move down"
                >
                  <ArrowDown size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <DependencyBuilder wpList={wpList} />

      <NavRow onBack={ctx.back} primaryLabel="Continue →" onPrimary={ctx.next} />
    </div>
  );
}

function DependencyBuilder({ wpList }: { wpList: WorkPackageWithStatus[] }) {
  const [edges, setEdges] = useState<DrawnEdge[]>([]);
  const [pred, setPred] = useState("");
  const [succ, setSucc] = useState("");
  const [edgeError, setEdgeError] = useState<string | null>(null);

  const addEdge = useMutation({
    mutationFn: (edge: DrawnEdge) =>
      dependenciesApi.createWpEdge({
        predecessor_wp_id: edge.predecessor_wp_id,
        successor_wp_id: edge.successor_wp_id,
      }),
    onSuccess: (_data, edge) => {
      setEdges((prev) => [...prev, edge]);
      setPred("");
      setSucc("");
      setEdgeError(null);
    },
    onError: (err) => setEdgeError(calmMessage(err)),
  });
  const removeEdge = useMutation({
    mutationFn: (edge: DrawnEdge) => dependenciesApi.removeWpEdge(edge.predecessor_wp_id, edge.successor_wp_id),
    onSuccess: (_data, edge) =>
      setEdges((prev) =>
        prev.filter(
          (item) =>
            item.predecessor_wp_id !== edge.predecessor_wp_id ||
            item.successor_wp_id !== edge.successor_wp_id,
        ),
      ),
  });

  const wpTitle = useMemo(() => {
    const map = new Map(wpList.map((wp) => [wp.id, wp.title]));
    return (id: string) => map.get(id) ?? "Work package";
  }, [wpList]);
  const canAdd = pred && succ && pred !== succ && !addEdge.isPending;

  return (
    <section className="flex flex-col gap-3">
      <span className="text-[11px] font-extrabold uppercase tracking-wider text-text-tertiary">
        Key dependencies
      </span>
      {wpList.length < 2 ? (
        <p className="text-xs font-semibold text-text-tertiary">Add at least two work packages to draw a dependency.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Must finish first">
            <select
              value={pred}
              onChange={(event) => setPred(event.target.value)}
              className="rounded-[9px] border border-border bg-bg px-3 py-2 text-sm font-bold outline-none focus:border-progress"
            >
              <option value="">Choose...</option>
              {wpList.map((wp) => (
                <option key={wp.id} value={wp.id}>
                  {wp.title}
                </option>
              ))}
            </select>
          </Field>
          <span className="pb-2.5 text-text-tertiary">→</span>
          <Field label="Then can start">
            <select
              value={succ}
              onChange={(event) => setSucc(event.target.value)}
              className="rounded-[9px] border border-border bg-bg px-3 py-2 text-sm font-bold outline-none focus:border-progress"
            >
              <option value="">Choose...</option>
              {wpList.map((wp) => (
                <option key={wp.id} value={wp.id}>
                  {wp.title}
                </option>
              ))}
            </select>
          </Field>
          <Button
            type="button"
            variant="secondary"
            onClick={() => canAdd && addEdge.mutate({ predecessor_wp_id: pred, successor_wp_id: succ })}
            disabled={!canAdd}
          >
            Add dependency
          </Button>
        </div>
      )}
      {edgeError && <p className="rounded-[10px] bg-warning-soft px-3 py-2 text-xs font-bold text-warning">{edgeError}</p>}
      {edges.map((edge) => (
        <div
          key={`${edge.predecessor_wp_id}->${edge.successor_wp_id}`}
          className="flex items-center gap-2 rounded-[9px] border border-border bg-bg px-3 py-2 text-xs font-bold"
        >
          <span>{wpTitle(edge.predecessor_wp_id)}</span>
          <span className="text-text-tertiary">→</span>
          <span>{wpTitle(edge.successor_wp_id)}</span>
          <button
            type="button"
            onClick={() => removeEdge.mutate(edge)}
            className="ml-auto text-text-tertiary hover:text-warning"
          >
            Delete
          </button>
        </div>
      ))}
    </section>
  );
}

function suggestOrder(wps: WorkPackageWithStatus[]) {
  return [...wps].sort((a, b) => {
    if (a.is_time_fixed !== b.is_time_fixed) return a.is_time_fixed ? -1 : 1;
    const diffWeight: Record<string, number> = { low: 0, mid: 1, high: 2 };
    return (diffWeight[a.difficulty ?? "mid"] ?? 1) - (diffWeight[b.difficulty ?? "mid"] ?? 1);
  });
}

function moveBefore(ids: string[], fromId: string, toId: string) {
  const next = ids.filter((id) => id !== fromId);
  const index = next.indexOf(toId);
  if (index < 0) return ids;
  next.splice(index, 0, fromId);
  return next;
}
