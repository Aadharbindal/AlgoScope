import { ev } from '../trace/tracer';
import { CELL_STATE } from '../trace/types';
import { graphOf, nodeIdsOf, parseGraph } from './graph';
import { computed, conceptual } from './checkpoints';
import { AlgorithmDef, RunFn } from './types';

const CPP = `vector<int> dijkstra(vector<vector<pair<int, int>>>& adj, int n, int src) {
    vector<int> dist(n, INF);
    vector<bool> done(n, false);

    dist[src] = 0;

    for (int k = 0; k < n; k++) {
        int u = -1;
        for (int i = 0; i < n; i++)
            if (!done[i] && (u == -1 || dist[i] < dist[u])) u = i;

        if (u == -1 || dist[u] == INF) break;
        done[u] = true;

        for (auto [v, w] : adj[u]) {
            if (dist[u] + w < dist[v])
                dist[v] = dist[u] + w;
        }
    }

    return dist;
}`;

const C = `void dijkstra(int adj[][32], int wt[][32], int deg[], int n, int src, int dist[]) {
    int done[32] = {0};
    for (int i = 0; i < n; i++) dist[i] = INF;

    dist[src] = 0;

    for (int k = 0; k < n; k++) {
        int u = -1;
        for (int i = 0; i < n; i++)
            if (!done[i] && (u == -1 || dist[i] < dist[u])) u = i;

        if (u == -1 || dist[u] == INF) break;
        done[u] = 1;

        for (int i = 0; i < deg[u]; i++) {
            int v = adj[u][i], w = wt[u][i];  if (dist[u] + w < dist[v])
                dist[v] = dist[u] + w;
        }
    }

    return;
}`;

const JAVA = `int[] dijkstra(List<List<int[]>> adj, int n, int src) {
    int[] dist = new int[n]; Arrays.fill(dist, INF);
    boolean[] done = new boolean[n];

    dist[src] = 0;

    for (int k = 0; k < n; k++) {
        int u = -1;
        for (int i = 0; i < n; i++)
            if (!done[i] && (u == -1 || dist[i] < dist[u])) u = i;

        if (u == -1 || dist[u] == INF) break;
        done[u] = true;

        for (int[] e : adj.get(u)) {
            int v = e[0], w = e[1];  if (dist[u] + w < dist[v])
                dist[v] = dist[u] + w;
        }
    }

    return dist;
}`;

const DEFAULT_EDGES = '0-1:4,0-2:1,2-1:2,1-3:5,2-3:8,3-4:3,2-4:10,4-5:2,3-5:6';

const INF = Number.POSITIVE_INFINITY;

/**
 * What the reader's lane calls unreachable.
 *
 * The reference works in real infinity; a 32-bit int cannot, so the starters
 * use a sentinel and anything at or above it is read as "never reached". A
 * billion is far past any distance these graphs can produce and far short of
 * where adding an edge weight would overflow.
 */
const UNREACHABLE = 1_000_000_000;
const show = (d: number) => (d === INF ? '∞' : String(d));

/** The true shortest distances, computed separately for the invariant. */
function trueDistances(
  nodes: { id: string }[],
  adj: Map<string, { to: string; weight: number }[]>,
  src: string,
): Map<string, number> {
  const dist = new Map<string, number>(nodes.map((n) => [n.id, INF]));
  if (!src) return dist;
  dist.set(src, 0);
  const done = new Set<string>();
  for (let k = 0; k < nodes.length; k++) {
    let best: string | null = null;
    for (const n of nodes) {
      if (done.has(n.id)) continue;
      if (best === null || (dist.get(n.id) ?? INF) < (dist.get(best) ?? INF)) best = n.id;
    }
    if (best === null || (dist.get(best) ?? INF) === INF) break;
    done.add(best);
    for (const { to, weight } of adj.get(best) ?? []) {
      const via = (dist.get(best) ?? INF) + weight;
      if (via < (dist.get(to) ?? INF)) dist.set(to, via);
    }
  }
  return dist;
}

const run: RunFn = (input, t, mut) => {
  const text = graphOf(input, 'edges', DEFAULT_EDGES);
  const { nodes, edges, adj } = parseGraph(text, false);
  const src = nodes[0]?.id ?? '';

  const dist = new Map<string, number>(nodes.map((n) => [n.id, INF]));
  const done = new Set<string>();
  const state: Record<string, number> = {};
  const overlay: Record<string, number | null> = {};
  let cursor: string | null = null;

  for (const n of nodes) state[n.id] = CELL_STATE.unseen;
  const paint = () => {
    for (const n of nodes) {
      const d = dist.get(n.id) ?? INF;
      overlay[n.id] = d === INF ? null : d;
      state[n.id] = done.has(n.id)
        ? CELL_STATE.visited
        : d === INF
          ? CELL_STATE.unseen
          : CELL_STATE.frontier;
    }
  };

  t.graph('g', nodes, edges, {
    directed: false,
    layout: 'circle',
    state: () => state,
    overlay: () => overlay,
    cursor: () => cursor,
    label: 'graph — the number under each node is its best known distance',
  });
  t.aux('dist', () => nodes.length * 2);

  const pickLargest = mut.has('pick-largest');
  const noSettle = mut.has('no-settle');
  // Relaxing with the edge weight alone, forgetting how far away u already is.
  const forgetPrefix = mut.has('forget-prefix');

  const truth = trueDistances(nodes, adj, src);

  // Once a node is settled, Dijkstra claims its distance is final. That is the
  // claim, so that is what gets checked — against a separately computed table.
  const recheck = () => {
    let exact = 1;
    for (const id of done) {
      if ((dist.get(id) ?? INF) !== (truth.get(id) ?? INF)) exact = 0;
    }
    t.derive({ exact });
  };

  t.enter('dijkstra', `dijkstra(adj, ${nodes.length}, ${src})`);
  t.step(2, { n: nodes.length, u: null, v: null, settled: 0 }, 'Every distance starts at infinity — nothing is known yet.');

  if (!src) {
    t.step(21, { n: 0, u: null, v: null, settled: 0 }, 'There are no nodes.');
    t.exit();
    return '';
  }

  dist.set(src, 0);
  paint();
  recheck();
  t.step(5, { n: nodes.length, u: null, v: null, settled: 0 }, `${src} is zero from itself. Everything else is still unknown.`);

  let guard = 0;
  for (let k = 0; k < nodes.length && guard++ < 100_000; k++) {
    t.step(7, { n: nodes.length, k, u: null, v: null, settled: done.size }, `Round ${k + 1}: find the closest node not yet settled.`);

    let u: string | null = null;
    for (const n of nodes) {
      if (done.has(n.id)) continue;
      const better = pickLargest
        ? u === null || (dist.get(n.id) ?? INF) > (dist.get(u) ?? INF)
        : u === null || (dist.get(n.id) ?? INF) < (dist.get(u) ?? INF);
      t.step(
        10,
        { n: nodes.length, k, u: u ?? null, v: n.id, settled: done.size, d: show(dist.get(n.id) ?? INF) },
        better
          ? `${n.id} is at ${show(dist.get(n.id) ?? INF)} — the best candidate so far.`
          : `${n.id} is at ${show(dist.get(n.id) ?? INF)}, no better than ${u}.`,
        ev.cmp({ kind: 'literal', value: show(dist.get(n.id) ?? INF) }, pickLargest ? '>' : '<', { kind: 'literal', value: u ? show(dist.get(u) ?? INF) : '∞' }, better),
      );
      if (better) u = n.id;
    }

    const stuck = u === null || (dist.get(u) ?? INF) === INF;
    t.step(12, { n: nodes.length, k, u: u ?? null, v: null, settled: done.size }, stuck ? 'Nothing reachable is left. Stop.' : `${u} is the closest unsettled node, at ${show(dist.get(u!) ?? INF)}.`, ev.cmp({ kind: 'literal', value: stuck ? 'INF' : 'finite' }, '==', { kind: 'literal', value: 'INF' }, stuck));
    if (stuck) break;

    if (!noSettle) done.add(u!);
    cursor = u;
    paint();
    recheck();
    t.step(13, { n: nodes.length, k, u, v: null, settled: done.size, d: show(dist.get(u!) ?? INF) }, noSettle ? `${u} is not marked as settled, so it can be picked again.` : `Settle ${u}. Nothing can reach it more cheaply than ${show(dist.get(u!) ?? INF)} now.`, ev.visit('g', u!));

    for (const { to: v, weight: w } of adj.get(u!) ?? []) {
      const via = forgetPrefix ? w : (dist.get(u!) ?? INF) + w;
      const better = via < (dist.get(v) ?? INF);
      t.step(16, { n: nodes.length, k, u, v, settled: done.size, via, d: show(dist.get(v) ?? INF) }, better
          ? `${forgetPrefix ? `The edge ${u}–${v} alone costs ${via}` : `Going ${u}→${v} costs ${via}`}, better than ${show(dist.get(v) ?? INF)}.`
          : `${forgetPrefix ? `The edge ${u}–${v} alone costs ${via}` : `Going ${u}→${v} costs ${via}`}, no better than ${show(dist.get(v) ?? INF)}.`, ev.cmp({ kind: 'literal', value: via }, '<', { kind: 'literal', value: show(dist.get(v) ?? INF) }, better));
      if (!better) continue;
      dist.set(v, via);
      paint();
      recheck();
      t.step(17, { n: nodes.length, k, u, v, settled: done.size, d: via }, forgetPrefix ? `${v} is recorded as ${via} — the weight of the last edge, with the journey to ${u} left out.` : `${v} is now ${via} from ${src}, by way of ${u}.`, ev.write('g', 0, via));
    }
  }

  cursor = null;
  // Every node, not merely the ones this run got round to settling.
  t.derive({
    allExact: nodes.every((node) => (dist.get(node.id) ?? INF) === (truth.get(node.id) ?? INF))
      ? 1
      : 0,
  });
  t.exit();
  const answer = nodes.map((n) => `${n.id}:${show(dist.get(n.id) ?? INF)}`).join(' ');
  t.step(21, { n: nodes.length, u: null, v: null, settled: done.size }, `Shortest distances from ${src}: ${answer}.`);
  return answer;
};

/** A weighted chain with shortcuts, so a greedy pick is genuinely tested. */
function weightedGraph(n: number): string {
  const parts: string[] = [];
  for (let i = 0; i < n - 1; i++) parts.push(`${i}-${i + 1}:${(i % 7) + 1}`);
  for (let i = 0; i + 3 < n; i += 3) parts.push(`${i}-${i + 3}:${(i % 5) + 2}`);
  return parts.join(',');
}

export const dijkstra: AlgorithmDef = {
  slug: 'dijkstra',
  name: "Dijkstra's Shortest Path",
  category: 'graphs',
  tagline: 'Shortest routes when the edges have weights, by always settling the nearest node next.',
  intuition: [
    'Breadth-first search works because every edge costs the same, so the first time a node is reached is the cheapest. Put weights on the edges and that stops being true — a route with more edges can be cheaper — and the queue has to be replaced by something that always hands back the closest node instead of the earliest one.',
    'That is the entire idea. Repeatedly take the unsettled node with the smallest known distance, declare it final, and use it to improve its neighbours. It is greedy, and the greed is justified: since every edge costs something, no route through a node that is farther away can arrive more cheaply.',
    'The word "settled" is doing real work. A distance can improve any number of times while a node is unsettled, and never again afterwards — and that is precisely the claim that fails the moment an edge is allowed a negative weight.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'g',
    pointers: [],
    regions: [],
    invariant: {
      text: 'Every settled node already holds its true shortest distance.',
      check: 'exact === 1',
      when: 'defined(exact)',
      why: 'This is the promise that makes the greed safe, and it is why a settled node is never looked at again. It holds because the node picked is the closest unsettled one: any other route to it would have to pass through a node that is farther away and then travel a non-negative edge, which cannot come out cheaper. Pick the farthest node instead and the claim fails on the very first round.',
    },
    postcondition: {
      text: 'Every node holds its true shortest distance from the source.',
      check: 'allExact === 1',
      why: 'The invariant checks the nodes settled so far, so an implementation that settles nothing at all satisfies it vacuously — nothing settled, nothing wrong. This asks about every node, which is the only version of the question a caller has ever cared about.',
    },
  },
  run,
  defaultInput: { edges: DEFAULT_EDGES },
  fields: [
    {
      key: 'edges',
      label: 'Weighted edges',
      kind: 'text',
      help: 'Like 0-1:4 — an edge from 0 to 1 costing 4. The first node mentioned is the source.',
    },
  ],
  validate: (input) => {
    const { nodes, edges, weighted } = parseGraph(graphOf(input, 'edges', DEFAULT_EDGES), false);
    if (nodes.length === 0) return 'No nodes. Write at least one edge, like 0-1:4.';
    if (nodes.length > 26) return 'Capped at 26 nodes here so the picture stays readable.';
    if (!weighted) return 'No weights given. Without them every edge costs 1 and breadth-first search is the right tool.';
    if (edges.some((e) => (e.weight ?? 1) < 0)) {
      return 'A negative weight breaks the assumption this algorithm rests on: that going further can never get cheaper. Dijkstra gives wrong answers on such a graph, so it is not run on one.';
    }
    return null;
  },
  makeInput: (n) => ({ edges: weightedGraph(n) }),
  growthSizes: [8, 16, 24, 32, 48, 64],
  projectTo: 100_000,
  complexity: {
    time: 'O(V²) with a linear scan, which is O(n²) — a heap brings it to O(E log V)',
    space: 'O(V), which is O(n)',
    note: 'Written here with a plain scan for the nearest node, because that is the version worth reading: the priority queue is an optimisation of one line, and swapping it in changes the cost without changing a single thing about why the algorithm is correct.',
  },
  userLane: {
    fnName: 'dijkstra',
    compareBy: 'return',
    binds: 'weighted',
    graph: { directed: false, fallback: DEFAULT_EDGES },
    note:
      'A node you never reach keeps INF. Anything a billion or more is read as unreachable and ' +
      'printed as ∞, which is what the starters mean by INF — pick a smaller sentinel and it will ' +
      'be compared as the number it is.',
    normalise: (returned, input, lane) => {
      const ids = nodeIdsOf(input, lane.graph!);
      const parts = returned === '' ? [] : returned.split(',');
      return ids
        .map((id, i) => {
          const d = parts[i];
          if (d === undefined) return `${id}:?`;
          return `${id}:${Number(d) >= UNREACHABLE ? '∞' : d}`;
        })
        .join(' ');
    },
    starters: {
      cpp: `vector<int> dijkstra(vector<vector<int>>& adj, vector<vector<int>>& wt, int n, int src) {
    int INF = 1000000000;
    vector<int> dist(n, INF);
    vector<int> done(n, 0);

    dist[src] = 0;

    for (int round = 0; round < n; round++) {
        int u = -1;
        for (int i = 0; i < n; i++)
            if (done[i] == 0 && (u == -1 || dist[i] < dist[u])) u = i;

        if (u == -1 || dist[u] == INF) break;
        done[u] = 1;

        for (int k = 0; k < adj[u].size(); k++) {
            int v = adj[u][k], w = wt[u][k];

            if (dist[u] + w < dist[v])
                dist[v] = dist[u] + w;
        }
    }

    return dist;
}`,
      c: `int* dijkstra(int adj[][32], int wt[][32], int deg[], int n, int src) {
    int INF = 1000000000;
    int dist[n];
    int done[n];

    for (int i = 0; i < n; i++) dist[i] = INF;

    dist[src] = 0;

    for (int round = 0; round < n; round++) {
        int u = -1;
        for (int i = 0; i < n; i++)
            if (done[i] == 0 && (u == -1 || dist[i] < dist[u])) u = i;

        if (u == -1 || dist[u] == INF) break;
        done[u] = 1;

        for (int k = 0; k < deg[u]; k++) {
            int v = adj[u][k], w = wt[u][k];

            if (dist[u] + w < dist[v])
                dist[v] = dist[u] + w;
        }
    }

    return dist;
}`,
      java: `int[] dijkstra(int[][] adj, int[][] wt, int n, int src) {
    int INF = 1000000000;
    int[] dist = new int[n];
    int[] done = new int[n];

    Arrays.fill(dist, INF);
    dist[src] = 0;

    for (int round = 0; round < n; round++) {
        int u = -1;
        for (int i = 0; i < n; i++)
            if (done[i] == 0 && (u == -1 || dist[i] < dist[u])) u = i;

        if (u == -1 || dist[u] == INF) break;
        done[u] = 1;

        for (int k = 0; k < adj[u].length; k++) {
            int v = adj[u][k], w = wt[u][k];

            if (dist[u] + w < dist[v])
                dist[v] = dist[u] + w;
        }
    }

    return dist;
}`,
      js: `function dijkstra(adj, wt, n, src) {
  const INF = 1000000000;
  let dist = new Array(n).fill(INF);
  let done = new Array(n).fill(0);

  dist[src] = 0;

  for (let round = 0; round < n; round++) {
    let u = -1;
    for (let i = 0; i < n; i++)
      if (done[i] === 0 && (u === -1 || dist[i] < dist[u])) u = i;

    if (u === -1 || dist[u] === INF) break;
    done[u] = 1;

    for (let k = 0; k < adj[u].length; k++) {
      let v = adj[u][k];
      let w = wt[u][k];

      if (dist[u] + w < dist[v]) dist[v] = dist[u] + w;
    }
  }

  return dist;
}`,
    },
  },
  mutations: [
    {
      id: 'pick-largest',
      edits: [{ line: 10, from: 'dist[i] < dist[u]', to: 'dist[i] > dist[u]' }],
      label: 'settle the farthest node',
      note: 'Reverses the comparison that picks which node to settle next.',
    },
    {
      id: 'forget-prefix',
      edits: [
        { line: 16, from: 'dist[u] + w < dist[v]', to: 'w < dist[v]' },
        { line: 17, from: 'dist[v] = dist[u] + w;', to: 'dist[v] = w;' },
      ],
      label: 'relax with the edge weight only',
      note: 'Forgets how far away u already is, so every edge is costed as if it started at the source.',
    },
    {
      id: 'no-settle',
      edits: [
        { line: 13, from: 'done[u] = true;', to: '// done[u] = true;', langs: ['cpp', 'java'] },
        { line: 13, from: 'done[u] = 1;', to: '// done[u] = 1;', langs: ['c'] },
      ],
      label: 'never mark as settled',
      note: 'The same node is chosen every round, so nothing else is ever expanded.',
    },
  ],
  variants: [
    {
      id: 'pick-largest',
      label: 'Settles the farthest node first',
      blurb: 'Returns distances, and several of them are too large.',
      explanation:
        'The greedy choice is the whole algorithm, and reversing it removes the one thing that justified it. Settling the farthest node means declaring final a distance that later rounds could still have improved — so the node is never revisited and keeps a route that was not the shortest. Nothing crashes and every node still gets a number, which is what makes this hard to spot without checking the numbers themselves.',
      mutations: ['pick-largest'],
    },
    {
      id: 'forget-prefix',
      label: 'Relaxes using the edge weight alone',
      blurb: 'Distances that are too small, and settled nodes that were never correct.',
      explanation:
        'The distance to a neighbour is the distance to here plus the edge — drop the first half and every edge is priced as though it began at the source. The numbers come out too small, which is the direction that matters: too large would merely be a worse answer, but too small means a node gets settled holding a distance no route can actually achieve. This is the one bug on this page that the invariant catches at the exact step it happens rather than at the end.',
      mutations: ['forget-prefix'],
    },
    {
      id: 'no-settle',
      label: 'Nodes are never marked as settled',
      blurb: 'Only the source ever gets a distance.',
      explanation:
        'The scan skips settled nodes, so with nothing ever settled it picks the same closest node in every round — the source, at distance zero — and relaxes its neighbours again and again. The loop runs its full n rounds and achieves nothing after the first. Watch the round counter climb while the picture stops changing.',
      mutations: ['no-settle'],
    },
  ],
  edgeCases: [
    { id: 'default', label: 'The default graph', input: { edges: DEFAULT_EDGES }, why: 'The direct edge 0–1 costs 4, but going 0–2–1 costs 3. More edges, less cost — the case breadth-first search gets wrong.' },
    { id: 'uniform', label: 'All weights equal', input: { edges: '0-1:1,0-2:1,1-3:1,2-3:1,3-4:1' }, why: 'With equal weights this is breadth-first search, and the two agree exactly.' },
    { id: 'detour', label: 'A cheap detour', input: { edges: '0-1:10,0-2:1,2-3:1,3-1:1' }, why: 'Three cheap edges beat one expensive one. The direct route is a trap.' },
    { id: 'line', label: 'A straight line', input: { edges: '0-1:2,1-2:3,2-3:4' }, why: 'One route to everything, so every choice is forced and the greedy pick cannot be wrong.' },
    { id: 'unreachable', label: 'An unreachable node', input: { edges: '0-1:2,1-2:3,5-6:1' }, why: 'Nodes 5 and 6 stay at infinity. The loop stops early rather than settling something it cannot reach.' },
    { id: 'single', label: 'One edge', input: { edges: '0-1:7' }, why: 'Two rounds, and the second has nothing left to improve.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 13, nth: 1 },
      question: 'The closest unsettled node is declared final. Why can no later round improve it?',
      options: [
        'Any other route would go through a farther node and then add a non-negative edge',
        'Because every node has been relaxed already',
        'Because the graph is connected',
        'It can be improved — that is what later rounds are for',
      ],
      answer: 'Any other route would go through a farther node and then add a non-negative edge',
      because:
        'This one sentence is the whole justification for the greed. Note where it leans: on edges being non-negative. Allow a negative edge and going further can get cheaper, the argument collapses, and Dijkstra silently returns wrong answers — which is why this page refuses to run on such a graph rather than pretending.',
    }),
    computed({
      where: { line: 16, nth: 2 },
      question: (step) => `Relaxing along ${step.vars.u}–${step.vars.v}. What is the cost being compared against the current best?`,
      answer: () => 'The distance to u, plus this edge',
      options: (a) => [
        a,
        'This edge on its own',
        'The distance to v, plus this edge',
        'The number of edges from the source',
      ],
      because:
        'The route to v through u costs everything it took to reach u and then one more edge. Forgetting the first half is a real and quiet bug: the numbers come out too small, so nodes get settled holding distances that no actual route achieves.',
    }),
    conceptual({
      where: { line: 10, nth: 4 },
      question: 'This scan finds the nearest unsettled node in O(n). What does a priority queue change?',
      options: [
        'The cost, and nothing about why the algorithm is correct',
        'Both the cost and the correctness argument',
        'Nothing measurable',
        'It removes the need to settle nodes',
      ],
      answer: 'The cost, and nothing about why the algorithm is correct',
      because:
        'A heap answers the same question faster — which node is nearest — and the proof above never mentions how that question is answered. This is worth separating: the O(V²) and O(E log V) versions are the same algorithm, and only one of them is easier to read.',
    }),
  ],
};
