/**
 * Pure mapping from the API's `ProjectFlow` (graph STRUCTURE, no coordinates) to a
 * laid-out React Flow node/edge model. The API gives us nodes, the two edge families,
 * and the critical path; dagre assigns positions (left-to-right layered, matching the
 * "finish-before" direction). Kept separate from the canvas component so the mapping
 * is unit-testable and the heavy React Flow import stays in the lazy chunk only where
 * it's needed.
 */
import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import type { DerivedStatus, ProjectFlow } from "@api-types";

export type FlowNodeData = {
  title: string;
  kind: "work_package" | "task";
  status: DerivedStatus;
  critical: boolean;
  /** For task nodes — the owning WP, so a task click opens that WP's sheet. */
  workPackageId?: string;
};
export type FlowEdgeData = {
  level: "task" | "work_package";
  predecessor: string;
  successor: string;
};

export type RFNode = Node<FlowNodeData>;
export type RFEdge = Edge<FlowEdgeData>;

const NODE_W = 184;
const NODE_H = 54;

/** Adjacency pairs "pred->succ" that lie consecutively on the critical path. */
function criticalAdjacency(path: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 1 < path.length; i++) out.add(`${path[i]}->${path[i + 1]}`);
  return out;
}

export function buildFlowGraph(
  flow: ProjectFlow,
  opts: { showTasks: boolean },
): { nodes: RFNode[]; edges: RFEdge[] } {
  const criticalSet = new Set(flow.critical_path);
  const criticalEdges = criticalAdjacency(flow.critical_path);

  const visible = flow.nodes.filter((n) => opts.showTasks || n.kind === "work_package");
  const visibleIds = new Set(visible.map((n) => n.id));

  const nodes: RFNode[] = visible.map((n) => ({
    id: n.id,
    type: "wbs",
    position: { x: 0, y: 0 },
    data: {
      title: n.title,
      kind: n.kind,
      status: n.derived_status,
      critical: criticalSet.has(n.id),
      workPackageId: n.work_package_id,
    },
  }));

  const edges: RFEdge[] = [];
  // Task edges only when tasks are visible.
  if (opts.showTasks) {
    for (const e of flow.edges.task) {
      if (!visibleIds.has(e.predecessor_task_id) || !visibleIds.has(e.successor_task_id)) continue;
      const crit = criticalEdges.has(`${e.predecessor_task_id}->${e.successor_task_id}`);
      edges.push({
        id: `t:${e.predecessor_task_id}->${e.successor_task_id}`,
        source: e.predecessor_task_id,
        target: e.successor_task_id,
        animated: crit,
        data: {
          level: "task",
          predecessor: e.predecessor_task_id,
          successor: e.successor_task_id,
        },
        style: crit
          ? { stroke: "var(--accent-progress)", strokeWidth: 2.5 }
          : { stroke: "var(--border-strong)" },
      });
    }
  }
  for (const e of flow.edges.work_package) {
    if (!visibleIds.has(e.predecessor_wp_id) || !visibleIds.has(e.successor_wp_id)) continue;
    edges.push({
      id: `w:${e.predecessor_wp_id}->${e.successor_wp_id}`,
      source: e.predecessor_wp_id,
      target: e.successor_wp_id,
      data: {
        level: "work_package",
        predecessor: e.predecessor_wp_id,
        successor: e.successor_wp_id,
      },
      style: { stroke: "var(--border-strong)", strokeDasharray: "5 4" },
    });
  }

  // --- dagre layered layout ---
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 64 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  for (const n of nodes) {
    const p = g.node(n.id);
    if (p) n.position = { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 };
  }

  return { nodes, edges };
}
