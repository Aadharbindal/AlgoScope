import { GraphEdge, GraphNode } from '../trace/types';
import { Input } from './types';

/**
 * Graphs as text, because a graph editor is a different product.
 *
 * The notation is the one people already write on paper: `0-1` for an
 * undirected edge, `0>1` for a directed one, and `:` for a weight. It is
 * typed into an ordinary field, so it shares a link and survives a paste like
 * every other input on this site — which a click-and-drag canvas would not.
 *
 * Node order is the order the nodes are first mentioned. That matters more
 * than it sounds: it decides where each node is drawn and, for a depth-first
 * walk, which neighbour is tried first. Both are properties of the input, and
 * hiding them behind a sort would make the picture stop matching the text.
 */

export interface ParsedGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Neighbours in first-mention order, which is the order a walk uses. */
  adj: Map<string, { to: string; weight: number }[]>;
  weighted: boolean;
}

const EDGE = /^([A-Za-z0-9]+)\s*([->])\s*([A-Za-z0-9]+)(?::\s*(-?\d+))?$/;

export function parseGraph(text: string, directed: boolean): ParsedGraph {
  const nodes: GraphNode[] = [];
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  const adj = new Map<string, { to: string; weight: number }[]>();
  let weighted = false;

  const add = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    nodes.push({ id, label: id });
    adj.set(id, []);
  };

  for (const raw of text.split(',')) {
    const piece = raw.trim();
    if (!piece) continue;

    const m = EDGE.exec(piece);
    if (!m) {
      // A bare name is a node with no edges — an isolated vertex is a real
      // graph and the thing several of these algorithms get wrong.
      if (/^[A-Za-z0-9]+$/.test(piece)) add(piece);
      continue;
    }

    const [, from, arrow, to, w] = m;
    add(from);
    add(to);
    const weight = w === undefined ? 1 : Number(w);
    if (w !== undefined) weighted = true;

    edges.push({ from, to, ...(w !== undefined ? { weight } : {}) });
    adj.get(from)!.push({ to, weight });
    // `>` always means one-way, whatever the graph's default is.
    if (!directed && arrow === '-') adj.get(to)!.push({ to: from, weight });
  }

  return { nodes, edges, adj, weighted };
}

/**
 * The node names, in the order the algorithms see them.
 *
 * The reader's own code works in indices — a function returning `vector<int>`
 * has no way to answer "b" — so an answer comes back as positions and is
 * relabelled with this. Index i is the i-th node mentioned in the edge list,
 * which is the same order every view on this site draws them in.
 */
export const nodeIdsOf = (
  input: Input,
  spec: { directed: boolean; fallback: string },
): string[] => parseGraph(graphOf(input, 'edges', spec.fallback), spec.directed).nodes.map((n) => n.id);

/**
 * An answer given in node indices, re-spelled in the names those indices mean.
 *
 * A translation between two spellings of one answer, and nothing more: it
 * never repairs a wrong answer, and a list of the wrong length still comes out
 * the wrong length.
 */
export const relabelNodes = (returned: string, ids: string[]): string =>
  returned === '' ? '' : returned.split(',').map((v) => ids[Number(v)] ?? v).join(',');

/** Read the graph field off an input, with a fallback that always parses. */
export const graphOf = (input: Input, key = 'edges', fallback = '0-1'): string => {
  const v = input[key];
  return typeof v === 'string' && v.trim() ? v : fallback;
};

/**
 * Layer each node by its distance from the sources, for the layered layout.
 *
 * Longest path from a source rather than shortest, so a directed edge always
 * points forward — a topological sort drawn with an edge pointing backwards
 * would be a picture contradicting the algorithm beside it.
 */
export function layerOf(
  nodes: GraphNode[],
  edges: GraphEdge[],
  directed: boolean,
): Record<string, number> {
  const layer: Record<string, number> = {};
  for (const n of nodes) layer[n.id] = 0;
  if (!directed) {
    // Undirected: breadth-first from the first node, which is a real distance.
    const dist = new Map<string, number>([[nodes[0]?.id ?? '', 0]]);
    const near = new Map<string, string[]>();
    for (const n of nodes) near.set(n.id, []);
    for (const e of edges) {
      near.get(e.from)?.push(e.to);
      near.get(e.to)?.push(e.from);
    }
    const queue = nodes.length ? [nodes[0].id] : [];
    for (let head = 0; head < queue.length; head++) {
      const at = queue[head];
      for (const next of near.get(at) ?? []) {
        if (dist.has(next)) continue;
        dist.set(next, (dist.get(at) ?? 0) + 1);
        queue.push(next);
      }
    }
    // Anything unreachable is put one column past the farthest thing reached.
    const max = Math.max(0, ...[...dist.values()]);
    for (const n of nodes) layer[n.id] = dist.get(n.id) ?? max + 1;
    return layer;
  }

  // Directed: relax along edges until nothing moves. Bounded by node count, so
  // a cycle settles instead of spinning.
  for (let pass = 0; pass < nodes.length + 1; pass++) {
    let moved = false;
    for (const e of edges) {
      const want = layer[e.from] + 1;
      if (want > layer[e.to]) {
        layer[e.to] = want;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return layer;
}
