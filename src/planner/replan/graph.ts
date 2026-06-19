export interface Edge {
  from: string;
  to: string;
}

export function buildPredecessorMap(edges: Edge[]): Map<string, Set<string>> {
  const pred = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!pred.has(edge.from)) pred.set(edge.from, new Set());
    const set = pred.get(edge.to) ?? new Set<string>();
    set.add(edge.from);
    pred.set(edge.to, set);
  }
  return pred;
}

export function buildOutgoingMap(edges: Edge[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const edge of edges) {
    const set = out.get(edge.from) ?? new Set<string>();
    set.add(edge.to);
    out.set(edge.from, set);
    if (!out.has(edge.to)) out.set(edge.to, new Set());
  }
  return out;
}

export function hasCycle(nodes: Iterable<string>, edges: Edge[]): boolean {
  const nodeSet = new Set(nodes);
  const out = buildOutgoingMap(edges);
  const indeg = new Map<string, number>();
  for (const n of nodeSet) indeg.set(n, 0);
  for (const edge of edges) {
    indeg.set(edge.from, indeg.get(edge.from) ?? 0);
    indeg.set(edge.to, (indeg.get(edge.to) ?? 0) + 1);
  }

  const queue = [...indeg.entries()].filter(([, deg]) => deg === 0).map(([n]) => n);
  let seen = 0;
  while (queue.length > 0) {
    const n = queue.shift()!;
    seen++;
    for (const m of out.get(n) ?? []) {
      const next = (indeg.get(m) ?? 0) - 1;
      indeg.set(m, next);
      if (next === 0) queue.push(m);
    }
  }
  return seen !== indeg.size;
}
