import { ev } from '../trace/tracer';
import { CELL_STATE, Scalar } from '../trace/types';
import { graphOf, nodeIdsOf, parseGraph } from './graph';
import { computed, conceptual, num } from './checkpoints';
import { AlgorithmDef, RunFn } from './types';

const CPP = `vector<int> bfs(vector<vector<int>>& adj, int src) {
    int n = adj.size();
    vector<int> dist(n, -1);
    queue<int> q;

    dist[src] = 0;
    q.push(src);

    while (!q.empty()) {
        int u = q.front();
        q.pop();

        for (int v : adj[u]) {
            if (dist[v] != -1)
                continue;

            dist[v] = dist[u] + 1;
            q.push(v);
        }
    }

    return dist;
}`;

const C = `void bfs(int adj[][32], int deg[], int n, int src, int dist[]) {
    for (int i = 0; i < n; i++) dist[i] = -1;
    int q[1024];
    int head = 0, tail = 0;

    dist[src] = 0;
    q[tail++] = src;

    while (head < tail) {
        int u = q[head];
        head++;

        for (int k = 0; k < deg[u]; k++) {
            int v = adj[u][k];  if (dist[v] != -1)
                continue;

            dist[v] = dist[u] + 1;
            q[tail++] = v;
        }
    }

    return;
}`;

const JAVA = `int[] bfs(List<List<Integer>> adj, int src) {
    int n = adj.size();
    int[] dist = new int[n]; Arrays.fill(dist, -1);
    Deque<Integer> q = new ArrayDeque<>();

    dist[src] = 0;
    q.addLast(src);

    while (!q.isEmpty()) {
        int u = q.peekFirst();
        q.pollFirst();

        for (int v : adj.get(u)) {
            if (dist[v] != -1)
                continue;

            dist[v] = dist[u] + 1;
            q.addLast(v);
        }
    }

    return dist;
}`;

const DEFAULT_EDGES = '0-1,0-2,1-3,2-3,2-4,3-5,4-5,5-6,4-7,6-7';

const run: RunFn = (input, t, mut) => {
  const text = graphOf(input, 'edges', DEFAULT_EDGES);
  const { nodes, edges, adj } = parseGraph(text, false);
  const src = nodes[0]?.id ?? '';

  const dist = new Map<string, number>();
  const state: Record<string, number> = {};
  const overlay: Record<string, number | null> = {};
  const queue: Scalar[] = [];
  let cursor: string | null = null;

  for (const n of nodes) {
    state[n.id] = CELL_STATE.unseen;
    overlay[n.id] = null;
  }

  t.graph('g', nodes, edges, {
    directed: false,
    layout: 'layered',
    state: () => state,
    overlay: () => overlay,
    cursor: () => cursor,
    label: 'graph',
  });
  t.seq('queue', queue, 'queue', 'queue (front on the left)');
  t.aux('queue', () => queue.length);
  t.aux('dist', () => dist.size);

  // Taking from the back is depth-first search wearing this one's clothes.
  const fromBack = mut.has('take-from-back');
  const noSeenCheck = mut.has('no-seen-check');

  t.enter('bfs', `bfs(adj, ${src})`);
  t.step(2, { n: nodes.length, u: null, v: null, queued: 0, settled: 0 }, `${nodes.length} nodes, ${edges.length} edges. Distances start unknown.`);

  if (!src) {
    t.step(22, { n: 0, u: null, v: null, queued: 0, settled: 0 }, 'There are no nodes, so there is nothing to search.');
    t.exit();
    return '';
  }

  dist.set(src, 0);
  state[src] = CELL_STATE.frontier;
  overlay[src] = 0;
  t.step(6, { n: nodes.length, u: null, v: null, queued: 0, settled: 0 }, `Node ${src} is zero steps from itself.`);
  queue.push(src);
  t.step(7, { n: nodes.length, u: null, v: null, queued: 1, settled: 0 }, `Put ${src} in the queue. Everything else is discovered from it.`, ev.push('queue', src));

  // The property the queue provides, and the reason the seen-check is safe.
  let lastPopped = -1;
  let ordered = 1;
  let guard = 0;

  while (queue.length > 0 && guard++ < 100_000) {
    t.step(9, { n: nodes.length, u: null, v: null, queued: queue.length, settled: state ? Object.values(state).filter((s) => s === CELL_STATE.visited).length : 0 }, `${queue.length} node${queue.length === 1 ? '' : 's'} waiting.`, ev.cmp({ kind: 'var', name: 'queued' }, '>', { kind: 'literal', value: 0 }, true));

    const at = fromBack ? queue.length - 1 : 0;
    const u = String(queue.splice(at, 1)[0]);
    cursor = u;
    state[u] = CELL_STATE.visited;

    const du = dist.get(u) ?? 0;
    if (du < lastPopped) ordered = 0;
    lastPopped = du;
    t.derive({ ordered });

    const settled = Object.values(state).filter((s) => s === CELL_STATE.visited).length;
    t.step(10, { n: nodes.length, u, v: null, d: du, queued: queue.length + 1, settled }, `Take ${u} off the ${fromBack ? 'back' : 'front'}. It is ${du} step${du === 1 ? '' : 's'} from ${src}.`, ev.visit('g', u));
    t.step(11, { n: nodes.length, u, v: null, d: du, queued: queue.length, settled }, 'Remove it so it is never expanded twice.', ev.pop('queue', u));

    for (const { to: v } of adj.get(u) ?? []) {
      const known = dist.has(v);
      t.step(13, { n: nodes.length, u, v, d: du, queued: queue.length, settled }, `Look along the edge ${u}–${v}.`, ev.readNode('g', v));
      t.step(
        14,
        { n: nodes.length, u, v, d: du, queued: queue.length, settled },
        known
          ? `${v} already has a distance of ${dist.get(v)}, reached by a route no longer than this one.`
          : `${v} has not been reached yet.`,
        ev.cmp({ kind: 'literal', value: known ? 'known' : 'new' }, '!=', { kind: 'literal', value: '-1' }, known),
      );
      if (known && !noSeenCheck) {
        t.step(15, { n: nodes.length, u, v, d: du, queued: queue.length, settled }, 'Skip it.');
        continue;
      }

      dist.set(v, du + 1);
      overlay[v] = du + 1;
      if (state[v] !== CELL_STATE.visited) state[v] = CELL_STATE.frontier;
      t.step(17, { n: nodes.length, u, v, d: du + 1, queued: queue.length, settled }, `${v} is ${du + 1} from ${src} — one more than ${u}.`);
      queue.push(v);
      t.step(18, { n: nodes.length, u, v, d: du + 1, queued: queue.length, settled }, `Queue ${v} behind everything already waiting.`, ev.push('queue', v));
    }
  }

  cursor = null;
  const settled = Object.values(state).filter((s) => s === CELL_STATE.visited).length;
  t.step(9, { n: nodes.length, u: null, v: null, queued: 0, settled }, 'The queue is empty. Everything reachable has been reached.', ev.cmp({ kind: 'var', name: 'queued' }, '>', { kind: 'literal', value: 0 }, false));
  t.exit();

  const answer = nodes.map((n) => `${n.id}:${dist.has(n.id) ? dist.get(n.id) : -1}`).join(' ');
  // Distances computed separately, so the run is checked against something it
  // did not produce.
  const truth = trueDistances(nodes, adj, src);
  t.derive({
    distancesOk: nodes.every((node) => (dist.get(node.id) ?? -1) === truth.get(node.id)) ? 1 : 0,
  });
  t.step(22, { n: nodes.length, u: null, v: null, queued: 0, settled }, `Distances from ${src}: ${answer}.`);
  return answer;
};

/** Shortest distances from `src`, computed separately from the run being judged. */
function trueDistances(
  nodes: { id: string }[],
  adj: Map<string, { to: string }[]>,
  src: string,
): Map<string, number> {
  const dist = new Map<string, number>(nodes.map((n) => [n.id, -1]));
  if (!src) return dist;
  dist.set(src, 0);
  const queue = [src];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head];
    for (const { to } of adj.get(at) ?? []) {
      if ((dist.get(to) ?? -1) !== -1) continue;
      dist.set(to, (dist.get(at) ?? 0) + 1);
      queue.push(to);
    }
  }
  return dist;
}

/** A ring of `n` nodes with a chord every third, so distances really grow. */
function ringGraph(n: number): string {
  const parts: string[] = [];
  for (let i = 0; i < n - 1; i++) parts.push(`${i}-${i + 1}`);
  for (let i = 0; i + 3 < n; i += 3) parts.push(`${i}-${i + 3}`);
  return parts.join(',');
}

export const graphBfs: AlgorithmDef = {
  slug: 'graph-bfs',
  name: 'Breadth-first Search',
  category: 'graphs',
  tagline: 'Spread outwards one edge at a time, and every node is reached by its shortest route.',
  intuition: [
    'A grid is a graph where the edges are implied by adjacency. Take that away and nothing about the search changes: a queue, a distance for each node, and a rule that a node is only ever recorded once.',
    'The order the queue enforces is the whole guarantee. Everything one edge away is finished before anything two edges away begins, so the first time a node is given a distance, no shorter route to it can still be waiting to be explored.',
    'That is also why the already-reached check is not an optimisation. Reaching a node a second time always costs at least as much as the first time did, so keeping the first distance is not merely faster — it is what makes the answer correct.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'g',
    pointers: [],
    regions: [],
    invariant: {
      text: 'Nodes come off the queue in non-decreasing order of distance.',
      check: 'ordered === 1',
      when: 'defined(ordered)',
      why: 'Everything breadth-first search claims rests on this one property, and it comes from the shape of the container rather than from any line that checks a distance. Because a node is never expanded before a nearer one, the first distance written for a node is the shortest — which is what makes overwriting it unnecessary, and what makes skipping an already-reached node safe rather than merely quick.',
    },
    postcondition: {
      text: 'Every reachable node holds its true shortest distance, and every unreachable one holds -1.',
      check: 'distancesOk === 1',
      why: 'The invariant is about the order nodes leave the queue, and a search that revisits nodes can still pop them in non-decreasing order while overwriting a correct distance with a longer one. This is the claim the caller was actually given, checked against distances computed separately from the run being judged.',
    },
  },
  run,
  defaultInput: { edges: DEFAULT_EDGES },
  fields: [
    {
      key: 'edges',
      label: 'Edges',
      kind: 'text',
      help: 'Comma-separated, like 0-1,0-2,1-3. The first node mentioned is the source. A bare name adds an isolated node.',
    },
  ],
  validate: (input) => {
    const { nodes } = parseGraph(graphOf(input, 'edges', DEFAULT_EDGES), false);
    if (nodes.length === 0) return 'No nodes. Write at least one edge, like 0-1.';
    if (nodes.length > 26) return 'Capped at 26 nodes here so the picture stays readable.';
    return null;
  },
  makeInput: (n) => ({ edges: ringGraph(n) }),
  growthSizes: [16, 32, 64, 128, 256, 512],
  projectTo: 1_000_000,
  complexity: {
    time: 'O(V + E) — O(n) in the node count, on the graphs measured here',
    space: 'O(V), which is O(n)',
    note: 'Every node is queued at most once and every edge is looked along at most twice — once from each end on an undirected graph. That is the whole cost, and it is why breadth-first search is the default answer to "shortest path" whenever the edges have no weights.',
  },
  userLane: {
    fnName: 'bfs',
    compareBy: 'return',
    binds: 'graph',
    graph: { directed: false, fallback: DEFAULT_EDGES },
    // The reader answers with one distance per node, in index order; the
    // reference prints those same distances against the node names.
    normalise: (returned, input, lane) => {
      const ids = nodeIdsOf(input, lane.graph!);
      const parts = returned === '' ? [] : returned.split(',');
      return ids.map((id, i) => `${id}:${parts[i] ?? '?'}`).join(' ');
    },
    starters: {
      cpp: `vector<int> bfs(vector<vector<int>>& adj, int n, int src) {
    vector<int> dist(n, -1);
    queue<int> q;

    dist[src] = 0;
    q.push(src);

    while (!q.empty()) {
        int u = q.front();
        q.pop();

        for (int k = 0; k < adj[u].size(); k++) {
            int v = adj[u][k];

            if (dist[v] != -1)
                continue;

            dist[v] = dist[u] + 1;
            q.push(v);
        }
    }

    return dist;
}`,
      c: `int* bfs(int adj[][32], int deg[], int n, int src) {
    int dist[n];
    int q[64];
    int head = 0, tail = 0;

    for (int i = 0; i < n; i++) dist[i] = -1;

    dist[src] = 0;
    q[tail] = src;
    tail = tail + 1;

    while (head < tail) {
        int u = q[head];
        head = head + 1;

        for (int k = 0; k < deg[u]; k++) {
            int v = adj[u][k];

            if (dist[v] != -1)
                continue;

            dist[v] = dist[u] + 1;
            q[tail] = v;
            tail = tail + 1;
        }
    }

    return dist;
}`,
      java: `int[] bfs(int[][] adj, int n, int src) {
    int[] dist = new int[n];
    Arrays.fill(dist, -1);

    Deque<Integer> q = new ArrayDeque<>();
    dist[src] = 0;
    q.addLast(src);

    while (!q.isEmpty()) {
        int u = q.peekFirst();
        q.pollFirst();

        for (int k = 0; k < adj[u].length; k++) {
            int v = adj[u][k];

            if (dist[v] != -1)
                continue;

            dist[v] = dist[u] + 1;
            q.addLast(v);
        }
    }

    return dist;
}`,
      js: `function bfs(adj, n, src) {
  let dist = new Array(n).fill(-1);
  let q = [src];
  dist[src] = 0;

  while (q.length > 0) {
    let u = q.shift();

    for (let k = 0; k < adj[u].length; k++) {
      let v = adj[u][k];

      if (dist[v] !== -1) continue;

      dist[v] = dist[u] + 1;
      q.push(v);
    }
  }

  return dist;
}`,
    },
  },
  mutations: [
    {
      id: 'take-from-back',
      edits: [
        { line: 10, from: 'int u = q.front();', to: 'int u = q.back();', langs: ['cpp'] },
        { line: 11, from: 'q.pop();', to: 'q.pop_back();', langs: ['cpp'] },
        { line: 10, from: 'int u = q[head];', to: 'int u = q[tail - 1];', langs: ['c'] },
        { line: 11, from: 'head++;', to: 'tail--;', langs: ['c'] },
        { line: 10, from: 'q.peekFirst()', to: 'q.peekLast()', langs: ['java'] },
        { line: 11, from: 'q.pollFirst();', to: 'q.pollLast();', langs: ['java'] },
      ],
      label: 'take from the back',
      note: 'Makes the queue a stack, and the search depth-first.',
    },
    {
      id: 'no-seen-check',
      edits: [
        { line: 14, from: 'if (dist[v] != -1)', to: 'if (false)', langs: ['cpp', 'java'] },
        { line: 14, from: 'if (dist[v] != -1)', to: 'if (0)', langs: ['c'] },
      ],
      label: 'drop the already-reached check',
      note: 'Lets a node be reached again and overwritten with a longer distance.',
    },
  ],
  variants: [
    {
      id: 'take-from-back',
      label: 'Takes from the back of the queue',
      blurb: 'Reaches everything, and records distances that are not the shortest.',
      explanation:
        'One word, and the container is a stack. The search still reaches every connected node, so a test that only asks "did we visit everything" passes — but a node now gets whatever distance the first route that stumbled into it happened to cost. Watch the layered picture: instead of filling column by column, the search dives to the far side and works back.',
      mutations: ['take-from-back'],
    },
    {
      id: 'no-seen-check',
      label: 'No already-reached check',
      blurb: 'Overwrites distances that were already correct, and revisits nodes.',
      explanation:
        'A node reached at distance 1 can be reached again from a neighbour at distance 3 and rewritten to 4. The first arrival was already the shortest — that is what the queue gives you — so every later overwrite can only make the answer worse. The cost is real too: nodes go back into the queue repeatedly and the search stops being linear.',
      mutations: ['no-seen-check'],
    },
  ],
  edgeCases: [
    { id: 'default', label: 'The default graph', input: { edges: DEFAULT_EDGES }, why: 'Two routes to node 5 of different lengths — the case where taking from the back gives the wrong distance.' },
    { id: 'line', label: 'A straight line', input: { edges: '0-1,1-2,2-3,4-3,4-5' }, why: 'Only one route exists anywhere, so breadth-first and depth-first agree and the bug hides.' },
    { id: 'star', label: 'A star', input: { edges: '0-1,0-2,0-3,0-4,0-5' }, why: 'Everything is one step away. The queue holds every node at once.' },
    { id: 'disconnected', label: 'Two components', input: { edges: '0-1,1-2,3-4,4-5' }, why: 'Nodes 3, 4 and 5 are never reached and keep a distance of -1. Reachability is a real answer.' },
    { id: 'isolated', label: 'An isolated node', input: { edges: '0-1,1-2,7' }, why: 'A node with no edges at all. It exists, and it is unreachable.' },
    { id: 'cycle', label: 'A triangle', input: { edges: '0-1,1-2,2-0' }, why: 'Every node is reachable two ways. The seen-check is what stops the search going round forever.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 14, nth: 2 },
      question: 'A neighbour already has a distance, so it is skipped. What is being asserted?',
      options: [
        'It was reached earlier, so by a route no longer than this one',
        'It has already been fully explored',
        'It is not connected to this node',
        'It is the source',
      ],
      answer: 'It was reached earlier, so by a route no longer than this one',
      because:
        'Nodes leave the queue in non-decreasing order of distance, so an earlier arrival came through a node at least as close. Skipping is therefore free of consequence — and without it, a node could be rewritten with a longer distance and put back in the queue, which costs both correctness and linearity.',
    }),
    computed({
      where: { line: 10, nth: 2 },
      question: (step) => `Node ${step.vars.u} has just been taken off the queue at distance ${step.vars.d}. What is true of everything still in the queue?`,
      answer: (step) => `It is all at distance ${num(step, 'd')} or ${num(step, 'd') + 1}`,
      options: (a, step) => [
        a,
        `It is all at distance ${num(step, 'd')}`,
        'It could be at any distance',
        `It is all farther than ${num(step, 'd') + 1}`,
      ],
      because:
        'The queue only ever holds two adjacent layers at once — what is left of the current one, and what the current one has discovered. That is the structural fact behind "non-decreasing order", and it is also why the memory cost is the width of the graph rather than its size.',
    }),
    conceptual({
      where: { line: 13, nth: 1 },
      question: 'A grid version of this search exists on this site too. What is different about the code?',
      options: [
        'Only how neighbours are found',
        'The queue is replaced by a stack',
        'The distances are computed differently',
        'Nothing at all',
      ],
      answer: 'Only how neighbours are found',
      because:
        'A grid is a graph whose edges are implied by adjacency, so the search does not change — only the loop that enumerates neighbours does, from four offsets to a list. Recognising that a problem is a graph problem is usually the whole of the work; the algorithm afterwards is the part you already know.',
    }),
  ],
};
