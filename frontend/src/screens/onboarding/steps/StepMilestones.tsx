/**
 * A4 — Milestones & Dependencies (assisted, both OPTIONAL). Two light tasks:
 *   1. group work packages into milestones (PATCH work_package.milestone_id —
 *      some WPs may belong to none, §3.2),
 *   2. draw key finish-before dependencies between work packages
 *      (POST /work-package-dependencies).
 *
 * A dependency cycle returns 409: we surface it as a calm inline message and
 * leave the edge undrawn so the user picks a different ordering — never a
 * dead-end (invariant #1). Each action commits via its real write, so the step
 * is fully resumable from the persisted milestone assignments.
 *
 * Viewing/editing the full existing dependency graph lives in Project Detail
 * (F4 Flow); here we keep the drawing minimal and show the edges added this run.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dependenciesApi, projectsApi, workPackagesApi } from "@/api";
import { calmMessage } from "@/lib/apiError";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { StepHeader, NavRow } from "./_chrome";
import type { StepProps } from "../types";

interface DrawnEdge {
  predecessor_wp_id: string;
  successor_wp_id: string;
}

export function StepMilestones({ ctx }: StepProps) {
  const qc = useQueryClient();
  const projectId = ctx.projectId;

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

  const [newMs, setNewMs] = useState("");
  const createMs = useMutation({
    mutationFn: (title: string) => projectsApi.createMilestone(projectId!, { title }),
    onSuccess: () => {
      setNewMs("");
      void qc.invalidateQueries({ queryKey: ["onb-milestones", projectId] });
    },
  });

  const assign = useMutation({
    mutationFn: ({ wpId, milestoneId }: { wpId: string; milestoneId: string | null }) =>
      workPackagesApi.update(wpId, { milestone_id: milestoneId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["onb-wps", projectId] }),
  });

  // --- dependencies (drawn this run) ---
  const [edges, setEdges] = useState<DrawnEdge[]>([]);
  const [pred, setPred] = useState("");
  const [succ, setSucc] = useState("");
  const [edgeError, setEdgeError] = useState<string | null>(null);
  const addEdge = useMutation({
    mutationFn: (e: DrawnEdge) =>
      dependenciesApi.createWpEdge({ predecessor_wp_id: e.predecessor_wp_id, successor_wp_id: e.successor_wp_id }),
    onSuccess: (_data, e) => {
      setEdges((prev) => [...prev, e]);
      setPred("");
      setSucc("");
      setEdgeError(null);
    },
    onError: (err) => setEdgeError(calmMessage(err)),
  });
  const removeEdge = useMutation({
    mutationFn: (e: DrawnEdge) => dependenciesApi.removeWpEdge(e.predecessor_wp_id, e.successor_wp_id),
    onSuccess: (_data, e) =>
      setEdges((prev) =>
        prev.filter((x) => !(x.predecessor_wp_id === e.predecessor_wp_id && x.successor_wp_id === e.successor_wp_id)),
      ),
  });

  const wpTitle = useMemo(() => {
    const map = new Map(wpList.map((w) => [w.id, w.title]));
    return (id: string) => map.get(id) ?? "Work package";
  }, [wpList]);

  const canAddEdge = pred && succ && pred !== succ && !addEdge.isPending;

  return (
    <div className="flex flex-col gap-6">
      <StepHeader
        title="Add milestones and key dependencies"
        subtitle="Both are optional — group work into milestones and mark what must finish before what. You can refine these later in the project."
      />

      {/* Milestones */}
      <section className="flex flex-col gap-3">
        <span className="text-[11px] font-extrabold uppercase tracking-wider text-text-tertiary">
          Milestones
        </span>
        <div className="flex gap-2">
          <Input
            placeholder="e.g. Private beta"
            value={newMs}
            onChange={(e) => setNewMs(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newMs.trim()) {
                e.preventDefault();
                createMs.mutate(newMs.trim());
              }
            }}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => newMs.trim() && createMs.mutate(newMs.trim())}
            disabled={!newMs.trim() || createMs.isPending}
          >
            + New milestone
          </Button>
        </div>

        {wpList.length > 0 && msList.length > 0 && (
          <div className="flex flex-col gap-2">
            {wpList.map((wp) => (
              <div key={wp.id} className="flex items-center gap-3 rounded-[11px] border border-border bg-surface-2 px-3 py-2.5">
                <span className="text-[13px] font-bold">{wp.title}</span>
                <select
                  value={wp.milestone_id ?? ""}
                  onChange={(e) => assign.mutate({ wpId: wp.id, milestoneId: e.target.value || null })}
                  className="ml-auto rounded-[8px] border border-border bg-bg px-2.5 py-1.5 text-[12px] font-bold outline-none focus:border-progress"
                >
                  <option value="">— No milestone —</option>
                  {msList.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Dependencies */}
      <section className="flex flex-col gap-3">
        <span className="text-[11px] font-extrabold uppercase tracking-wider text-text-tertiary">
          Dependencies
        </span>
        {wpList.length < 2 ? (
          <p className="text-[12px] font-semibold text-text-tertiary">
            Add at least two work packages to draw a dependency.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Must finish first">
              <select
                value={pred}
                onChange={(e) => setPred(e.target.value)}
                className="rounded-[9px] border border-border bg-bg px-3 py-2 text-sm font-bold outline-none focus:border-progress"
              >
                <option value="">Choose…</option>
                {wpList.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.title}
                  </option>
                ))}
              </select>
            </Field>
            <span className="pb-2.5 text-text-tertiary">→</span>
            <Field label="Then can start">
              <select
                value={succ}
                onChange={(e) => setSucc(e.target.value)}
                className="rounded-[9px] border border-border bg-bg px-3 py-2 text-sm font-bold outline-none focus:border-progress"
              >
                <option value="">Choose…</option>
                {wpList.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.title}
                  </option>
                ))}
              </select>
            </Field>
            <Button
              type="button"
              variant="secondary"
              className="mb-0"
              onClick={() => canAddEdge && addEdge.mutate({ predecessor_wp_id: pred, successor_wp_id: succ })}
              disabled={!canAddEdge}
            >
              + Add dependency
            </Button>
          </div>
        )}

        {edgeError && (
          <p className="rounded-[10px] bg-warning-soft px-3 py-2 text-xs font-bold text-warning">{edgeError}</p>
        )}

        {edges.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {edges.map((e) => (
              <div
                key={`${e.predecessor_wp_id}->${e.successor_wp_id}`}
                className="flex items-center gap-2 rounded-[9px] border border-border bg-bg px-3 py-2 text-[12px] font-bold"
              >
                <span>{wpTitle(e.predecessor_wp_id)}</span>
                <span className="text-text-tertiary">→</span>
                <span>{wpTitle(e.successor_wp_id)}</span>
                <button
                  type="button"
                  onClick={() => removeEdge.mutate(e)}
                  className="ml-auto text-text-tertiary hover:text-warning"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <NavRow onBack={ctx.back} primaryLabel="Continue →" onPrimary={ctx.next} />
    </div>
  );
}
