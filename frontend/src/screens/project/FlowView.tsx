/**
 * Flow view (web-screens §C.1) — the dependency graph canvas (React Flow + dagre).
 * Lazy-loaded (default export) so the heavy deps land in a SEPARATE chunk, only
 * fetched when the Flow tab opens.
 *
 * THE SHARP EDGE — drag-to-connect with no phantom edge on a rejected create
 * (Principle 1 / cycle-409):
 *   We use CREATE-THEN-ADD, never optimistic-add. `onConnect` does NOT call
 *   addEdge. It validates locally (self / kind-mismatch → calm inline reject, no
 *   API), then POSTs the dependency. Only on 201 do we invalidate → REFETCH the
 *   flow (which also recomputes derived_status + critical_path so they can't go
 *   stale). On 409 (cycle / duplicate) or 422 (self) the edge is simply never
 *   added — there is no window where a phantom edge can exist.
 *
 * Edge delete: select an edge → Delete edge → DELETE the dep → refetch.
 * Node click: opens the WP side panel. The canvas intentionally shows work packages
 * only; tasks live in the side panel for the selected WP.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { dependenciesApi, projectsApi } from "@/api";
import { StatusPill } from "@/components/StatusPill";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { calmMessage } from "@/lib/apiError";
import { cn } from "@/lib/utils";
import { buildFlowGraph, type FlowEdgeData, type FlowNodeData } from "./flowGraph";

const STATUS_CARD: Record<FlowNodeData["status"], string> = {
  done: "border-progress/60 bg-progress-soft",
  in_progress: "border-info/60 bg-info-soft",
  blocked: "border-warning/60 bg-warning-soft",
  open: "border-border bg-bg",
};

/** Custom node — a status-colored card with target(left)/source(right) handles. */
function WbsNode({ data }: NodeProps<Node<FlowNodeData>>) {
  return (
    <div
      className={cn(
        "w-[184px] rounded-[8px] border px-3 py-2 shadow-[0_10px_24px_rgb(0_0_0/0.18)]",
        STATUS_CARD[data.status],
        data.critical && "border-progress ring-2 ring-progress/40",
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-bg !bg-system" />
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[9px] font-black uppercase tracking-wider text-text-tertiary">
          {data.kind === "work_package" ? "Work package" : "Task"}
        </span>
        <StatusPill status={data.status} />
      </div>
      <p className="truncate text-[13px] font-bold text-text-primary">{data.title}</p>
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-bg !bg-system" />
    </div>
  );
}

const nodeTypes = { wbs: WbsNode };

export default function FlowView({
  projectId,
  onSelectWp,
}: {
  projectId: string;
  onSelectWp?: (wpId: string) => void;
}) {
  const qc = useQueryClient();
  const flow = useQuery({
    queryKey: ["project", projectId, "flow"],
    queryFn: () => projectsApi.getFlow(projectId),
  });

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlowNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<FlowEdgeData>>([]);
  const [selectedEdge, setSelectedEdge] = useState<Edge<FlowEdgeData> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Re-layout whenever the (refetched) flow changes. Flow is WP-only by design.
  const graph = useMemo(
    () => (flow.data ? buildFlowGraph(flow.data, { showTasks: false }) : null),
    [flow.data],
  );
  useEffect(() => {
    if (!graph) return;
    setNodes(graph.nodes);
    setEdges(graph.edges);
    setSelectedEdge(null);
  }, [graph, setNodes, setEdges]);

  function refetch() {
    qc.invalidateQueries({ queryKey: ["project", projectId, "flow"] });
  }

  // --- CREATE-THEN-ADD: validate → POST → refetch on 201; never add on reject ---
  const onConnect = useCallback(
    (c: Connection) => {
      setNotice(null);
      if (!c.source || !c.target) return;
      if (c.source === c.target) {
        setNotice("A node can’t depend on itself.");
        return;
      }
      const src = nodes.find((n) => n.id === c.source);
      const tgt = nodes.find((n) => n.id === c.target);
      if (!src || !tgt) return;
      if (src.data.kind !== tgt.data.kind) {
        setNotice("Connect tasks to tasks, or work packages to work packages.");
        return;
      }
      const create =
        src.data.kind === "task"
          ? dependenciesApi.createTaskEdge({
              predecessor_task_id: c.source,
              successor_task_id: c.target,
            })
          : dependenciesApi.createWpEdge({
              predecessor_wp_id: c.source,
              successor_wp_id: c.target,
            });
      // Note: we do NOT addEdge here. The edge appears only after a successful
      // refetch — a 409/422 leaves the canvas exactly as it was (no phantom edge).
      create
        .then(() => {
          setNotice(null);
          refetch();
        })
        .catch((e) => setNotice(calmMessage(e)));
    },
    [nodes],
  );

  const onDeleteEdge = useCallback(() => {
    if (!selectedEdge?.data) return;
    const { level, predecessor, successor } = selectedEdge.data;
    const del =
      level === "task"
        ? dependenciesApi.removeTaskEdge(predecessor, successor)
        : dependenciesApi.removeWpEdge(predecessor, successor);
    del
      .then(() => {
        setSelectedEdge(null);
        refetch();
      })
      .catch((e) => setNotice(calmMessage(e)));
  }, [selectedEdge]);

  if (flow.isLoading)
    return <p className="p-6 text-sm font-bold text-text-tertiary">Loading flow canvas…</p>;
  if (flow.isError || !flow.data)
    return <p className="p-6 text-sm font-bold text-warning">Couldn’t load the flow.</p>;
  if (flow.data.nodes.length === 0)
    return (
      <EmptyState
        title="Nothing to map yet"
        hint="Add work packages and tasks, then draw dependencies between them here to see the flow."
        className="mt-4"
      />
    );

  return (
    <div className="flex h-full min-h-[620px] flex-col bg-bg">
      {/* --- toolbar --- */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-3">
        {flow.data.next_milestone && (
          <span className="inline-flex items-center gap-2 text-xs font-bold text-text-tertiary">
            <span className="grid h-5 w-5 rotate-45 place-items-center rounded-[5px] border border-system bg-system-soft">
              <span className="-rotate-45 text-[10px] text-system">◆</span>
            </span>
            Critical path to{" "}
            <span className="text-text-secondary">{flow.data.next_milestone.title}</span>
          </span>
        )}
        {selectedEdge && (
          <Button size="sm" variant="ghost" className="text-warning" onClick={onDeleteEdge}>
            Delete edge
          </Button>
        )}
        <span className="ml-auto text-[11px] font-semibold text-text-tertiary">
          Work packages only. Click a package to inspect and edit its tasks in the side panel.
        </span>
      </div>

      {notice && (
        <p className="rounded-[10px] bg-warning-soft px-3 py-2 text-xs font-bold text-warning">
          {notice}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgeClick={(_, edge) => setSelectedEdge(edge as Edge<FlowEdgeData>)}
          onNodeClick={(_, node) => {
            const d = (node as Node<FlowNodeData>).data;
            if (d.kind === "work_package") onSelectWp?.(node.id);
          }}
          onPaneClick={() => setSelectedEdge(null)}
          fitView
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ style: { strokeWidth: 2 } }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1.1} color="var(--border)" />
          <Controls
            showInteractive={false}
            className="!border !border-border !bg-surface-1 !shadow-lg [&_button]:!border-border [&_button]:!bg-surface-1 [&_button]:!text-text-primary"
          />
        </ReactFlow>
      </div>
    </div>
  );
}
