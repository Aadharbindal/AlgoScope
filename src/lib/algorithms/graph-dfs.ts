import { ev } from '../trace/tracer';
import { CELL_STATE, Scalar } from '../trace/types';
import { graphOf, nodeIdsOf, parseGraph, relabelNodes } from './graph';
import { computed, conceptual } from './checkpoints';
import { AlgorithmDef, RunFn } from './types';

const CPP = `void dfs(vector<vector<int>>& adj, int u, vector<bool>& seen, vector<int>& out) {
    seen[u] = true;
    out.push_back(u);

    for (int v : adj[u]) {
        if (seen[v])
            continue;

        dfs(adj, v, seen, out);
    }
}`;

const C = `void dfs(int adj[][32], int deg[], int u, int seen[], int out[], int* k) {
    seen[u] = 1;
    out[(*k)++] = u;

    for (int i = 0; i < deg[u]; i++) {
        int v = adj[u][i];  if (seen[v])
            continue;

        dfs(adj, deg, v, seen, out, k);
    }
}`;

const JAVA = `void dfs(List<List<Integer>> adj, int u, boolean[] seen, List<Integer> out) {
    seen[u] = true;
    out.add(u);

    for (int v : adj.get(u)) {
        if (seen[v])
            continue;

        dfs(adj, v, seen, out);
    }
}`;

const DEFAULT_EDGES = '0-1,0-2,1-3,2-3,2-4,3-5,4-5,5-6,4-7,6-7';

const run: RunFn = (input, t, mut) => {
  const text = graphOf(input, 'edges', DEFAULT_EDGES);
  const { nodes, edges, adj } = parseGraph(text, false);
  const src = nodes[0]?.id ?? '';

  const seen = new Set<string>();
  const out: Scalar[] = [];
  const state: Record<string, number> = {};
  const overlay: Record<string, number | null> = {};
  let cursor: string | null = null;

  for (const n of nodes) {
    state[n.id] = CELL_STATE.unseen;
    overlay[n.id] = null;
  }

  t.graph('g', nodes, edges, {
    directed: false,
    layout: 'circle',
    state: () => state,
    overlay: () => overlay,
    cursor: () => cursor,
    label: 'graph',
  });
  t.seq('out', out, 'flow', 'visit order');

  // Never marking a node leaves the recursion unable to stop on a cycle.
  const noMark = mut.has('no-mark');
  const wrongGuard = mut.has('wrong-guard');

  t.oracle({ total: nodes.length });

  if (!src) {
    t.step(2, { u: null, v: null, depth: 0, visited: 0 }, 'There are no nodes, so there is nothing to walk.');
    return '';
  }

  // Every node in `out` was reached along edges from the source — the property
  // depth-first search actually promises. Nothing about order, nothing about
  // distance: reachability, and that a node is recorded once.
  const recheck = () => {
    const once = new Set(out.map(String)).size === out.length;
    t.derive({ once: once ? 1 : 0 });
  };

  const walk = (u: string, depth: number) => {
    t.enter('dfs', `dfs(${u})`);
    if (!noMark) seen.add(u);
    state[u] = CELL_STATE.frontier;
    cursor = u;
    t.step(2, { u, v: null, depth, visited: out.length }, noMark ? `Reached ${u}, but it is never marked as seen.` : `Mark ${u} as seen, so nothing comes back to it.`, ev.visit('g', u));

    out.push(u);
    overlay[u] = out.length;
    recheck();
    t.step(3, { u, v: null, depth, visited: out.length }, `Record ${u}. It is the ${ordinal(out.length)} node reached.`);

    for (const { to: v } of adj.get(u) ?? []) {
      // The guard is meant to look at the neighbour. Looking at the node we are
      // standing on is a typo that type-checks.
      const guarded = wrongGuard ? seen.has(u) : seen.has(v);
      t.step(5, { u, v, depth, visited: out.length }, `Consider the edge ${u}–${v}.`, ev.readNode('g', v));
      t.step(
        6,
        { u, v, depth, visited: out.length },
        guarded
          ? `${wrongGuard ? u : v} has already been seen, so this edge leads nowhere new.`
          : `${v} has not been seen. Go there.`,
        ev.cmp({ kind: 'literal', value: guarded ? 'seen' : 'new' }, '==', { kind: 'literal', value: 'true' }, guarded),
      );
      if (guarded) {
        t.step(7, { u, v, depth, visited: out.length }, 'Skip it.');
        continue;
      }

      t.step(9, { u, v, depth, visited: out.length }, `Descend into ${v} before finishing ${u}. That is what makes this depth-first.`, ev.call('dfs', `dfs(${v})`));
      walk(v, depth + 1);
      cursor = u;
    }

    state[u] = CELL_STATE.visited;
    t.step(11, { u, v: null, depth, visited: out.length }, `Every edge out of ${u} has been followed. Return to the caller.`, ev.ret('dfs', u));
    t.exit();
  };

  walk(src, 0);
  cursor = null;

  const answer = out.join(',');
  // Everything reachable from the source, and nothing twice. The reachable set
  // is computed here by a plain flood fill rather than by the walk being judged.
  const reachable = floodFrom(adj, src);
  t.derive({
    reachedAll:
      out.length === reachable.size && out.every((v) => reachable.has(String(v))) ? 1 : 0,
  });
  t.step(11, { u: null, v: null, depth: 0, visited: out.length }, `Visit order: ${answer}.`);
  return answer;
};

const ordinal = (n: number) => {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
};

/** Everything reachable from `src`, found by a plain flood fill. */
function floodFrom(adj: Map<string, { to: string }[]>, src: string): Set<string> {
  const seen = new Set<string>();
  if (!src) return seen;
  const queue = [src];
  seen.add(src);
  for (let head = 0; head < queue.length; head++) {
    for (const { to } of adj.get(queue[head]) ?? []) {
      if (seen.has(to)) continue;
      seen.add(to);
      queue.push(to);
    }
  }
  return seen;
}

/** A line of `n` nodes with a chord every third — deep, and with real cycles. */
function chainGraph(n: number): string {
  const parts: string[] = [];
  for (let i = 0; i < n - 1; i++) parts.push(`${i}-${i + 1}`);
  for (let i = 0; i + 3 < n; i += 3) parts.push(`${i}-${i + 3}`);
  return parts.join(',');
}

export const graphDfs: AlgorithmDef = {
  slug: 'graph-dfs',
  name: 'Depth-first Search',
  category: 'graphs',
  tagline: 'Follow one edge as far as it goes before trying the next.',
  intuition: [
    'Breadth-first search keeps a queue; this keeps a call stack, and that single difference is the whole of it. Instead of finishing everything one edge away before going further, it commits to the first neighbour and does not come back until that branch is exhausted.',
    'The seen set is doing more work here than it looks. On a graph with a cycle it is not an optimisation at all — without it the recursion follows the cycle round and never returns. Take the mark away and watch the run stop being a run.',
    'Watch the call stack rather than the picture. Its depth is how far the search has committed, and it is why depth-first search is cheap in the width of a graph and expensive in its depth — exactly the opposite trade to breadth-first.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'g',
    pointers: [],
    regions: [],
    invariant: {
      text: 'No node is ever recorded twice.',
      check: 'once === 1',
      when: 'defined(once)',
      why: 'This is what the seen set buys, and it is the difference between a traversal and a walk that never ends. Depth-first search makes no promise about the order nodes come out in and none at all about distance — the only thing it guarantees is that every reachable node appears exactly once. Remove the mark and this fails on the first cycle.',
    },
    postcondition: {
      text: 'Every node reachable from the source appears in the output, exactly once.',
      check: 'reachedAll === 1',
      why: 'The invariant says nothing is recorded twice, which is trivially satisfied by a walk that records almost nothing. Reaching everything and reaching nothing twice are opposite failure modes, and a traversal has to promise both.',
    },
  },
  run,
  defaultInput: { edges: DEFAULT_EDGES },
  fields: [
    {
      key: 'edges',
      label: 'Edges',
      kind: 'text',
      help: 'Comma-separated, like 0-1,0-2,1-3. The first node mentioned is where the walk starts.',
    },
  ],
  validate: (input) => {
    const { nodes } = parseGraph(graphOf(input, 'edges', DEFAULT_EDGES), false);
    if (nodes.length === 0) return 'No nodes. Write at least one edge, like 0-1.';
    if (nodes.length > 26) return 'Capped at 26 nodes here so the picture stays readable.';
    return null;
  },
  makeInput: (n) => ({ edges: chainGraph(n) }),
  growthSizes: [16, 32, 64, 128, 256],
  projectTo: 1_000_000,
  complexity: {
    time: 'O(V + E) — O(n) in the node count, on the graphs measured here',
    space: 'O(V), which is O(n) — the recursion is as deep as the longest path',
    note: 'Each node is entered once and each edge is looked along once from each end. The space is the part worth noticing: it is the depth of the recursion, so a long thin graph costs as much stack as it has nodes — which is the failure mode breadth-first search does not have.',
  },
  userLane: {
    fnName: 'dfs',
    compareBy: 'return',
    binds: 'graph',
    graph: { directed: false, fallback: DEFAULT_EDGES },
    normalise: (returned, input, lane) => relabelNodes(returned, nodeIdsOf(input, lane.graph!)),
    starters: {
      cpp: `void walk(vector<vector<int>>& adj, int u, vector<int>& seen, vector<int>& out) {
    if (seen[u] == 1)
        return;

    seen[u] = 1;
    out.push_back(u);

    for (int k = 0; k < adj[u].size(); k++)
        walk(adj, adj[u][k], seen, out);
}

vector<int> dfs(vector<vector<int>>& adj, int n, int src) {
    vector<int> seen(n, 0);
    vector<int> out;

    walk(adj, src, seen, out);
    return out;
}`,
      c: `int walk(int adj[][32], int deg[], int u, int seen[], int out[], int k) {
    if (seen[u] == 1)
        return k;

    seen[u] = 1;
    out[k] = u;
    k = k + 1;

    for (int i = 0; i < deg[u]; i++)
        k = walk(adj, deg, adj[u][i], seen, out, k);

    return k;
}

int* dfs(int adj[][32], int deg[], int n, int src) {
    int seen[n];
    int room[n];

    int found = walk(adj, deg, src, seen, room, 0);

    int out[found];
    for (int i = 0; i < found; i++) out[i] = room[i];
    return out;
}`,
      java: `void walk(int[][] adj, int u, int[] seen, List<Integer> out) {
    if (seen[u] == 1)
        return;

    seen[u] = 1;
    out.add(u);

    for (int k = 0; k < adj[u].length; k++)
        walk(adj, adj[u][k], seen, out);
}

List<Integer> dfs(int[][] adj, int n, int src) {
    int[] seen = new int[n];
    List<Integer> out = new ArrayList<>();

    walk(adj, src, seen, out);
    return out;
}`,
    },
  },
  mutations: [
    {
      id: 'no-mark',
      edits: [
        { line: 2, from: 'seen[u] = true;', to: '// seen[u] = true;', langs: ['cpp', 'java'] },
        { line: 2, from: 'seen[u] = 1;', to: '// seen[u] = 1;', langs: ['c'] },
      ],
      label: 'never mark as seen',
      note: 'Nothing is ever recorded as visited, so a cycle is followed forever.',
    },
    {
      id: 'wrong-guard',
      edits: [{ line: 6, from: 'if (seen[v])', to: 'if (seen[u])' }],
      label: 'guard checks u, not v',
      note: 'Looks at the node being stood on instead of the one being considered.',
    },
  ],
  variants: [
    {
      id: 'no-mark',
      label: 'Nodes are never marked as seen',
      blurb: 'Does not finish. At all.',
      explanation:
        'On a graph with no cycles this would merely repeat work. On one with a cycle it follows the loop round and calls itself forever, and the run has to be stopped rather than completed. That is worth seeing once: the seen set is usually described as an optimisation, and here it is the only thing standing between a traversal and an infinite one.',
      mutations: ['no-mark'],
    },
    {
      id: 'wrong-guard',
      label: 'The guard checks the wrong node',
      blurb: 'Records the starting node and stops.',
      explanation:
        'One character. `seen[u]` instead of `seen[v]` asks "have I already visited where I am standing", and the answer is always yes — it was marked on the line above. So every edge is skipped and the walk never leaves the source. This is the kind of bug that compiles, type-checks, passes a test on a single-node graph, and does nothing at all on a real one.',
      mutations: ['wrong-guard'],
    },
  ],
  edgeCases: [
    { id: 'default', label: 'The default graph', input: { edges: DEFAULT_EDGES }, why: 'Several cycles, so the seen set is load-bearing from early on.' },
    { id: 'tree', label: 'No cycles', input: { edges: '0-1,0-2,1-3,1-4,2-5' }, why: 'A tree. Without a cycle, the unmarked version still terminates — which is exactly why the bug survives testing.' },
    { id: 'triangle', label: 'A triangle', input: { edges: '0-1,1-2,2-0' }, why: 'The smallest cycle. Three nodes are all it takes for the unmarked version to never return.' },
    { id: 'line', label: 'A straight line', input: { edges: '0-1,1-2,2-3,3-4,4-5' }, why: 'The recursion goes as deep as the graph is long — the case where stack, not time, is the limit.' },
    { id: 'star', label: 'A star', input: { edges: '0-1,0-2,0-3,0-4' }, why: 'Depth one everywhere. Depth-first and breadth-first produce the same order.' },
    { id: 'disconnected', label: 'Two components', input: { edges: '0-1,1-2,3-4' }, why: 'Nodes 3 and 4 are never reached. One call from one source only ever finds one component.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 2, nth: 2 },
      question: 'On a graph with a cycle, what happens if this mark is never made?',
      options: [
        'The recursion follows the cycle forever and never returns',
        'Some nodes are visited twice',
        'The output is in the wrong order',
        'Nothing — the guard below still stops it',
      ],
      answer: 'The recursion follows the cycle forever and never returns',
      because:
        'The guard below asks whether a node has been seen, and without this line the answer is always no. On a tree that merely repeats work; on anything with a cycle it is an infinite descent. The seen set is usually introduced as an optimisation, and here it is the only thing making the function a function.',
    }),
    conceptual({
      where: { line: 9, nth: 1 },
      question: 'The call descends into a neighbour before the current node has finished its other edges. What holds the unfinished work?',
      options: [
        'The call stack',
        'The seen set',
        'The output list',
        'Nothing — the other edges are abandoned',
      ],
      answer: 'The call stack',
      because:
        'Each frame remembers where it had got to in its own neighbour list, and that is precisely the job breadth-first search gives to an explicit queue. The two searches differ in nothing but which container holds the pending work — and therefore in whether the cost is the depth of the graph or its width.',
    }),
    computed({
      where: { line: 6, nth: 3 },
      question: () => 'A neighbour has already been seen, so the edge is skipped. What kind of edge is that?',
      answer: () => 'One that leads back into the part already explored',
      options: (a) => [
        a,
        'One that leads outside the graph',
        'A duplicate edge',
        'An edge with no weight',
      ],
      because:
        'Every skipped edge points back into territory the walk has already covered. Counting these is how depth-first search detects cycles, builds spanning trees, and finds strongly connected components — a whole family of algorithms is the same walk with different bookkeeping at exactly this line.',
    }),
  ],
};
