import { ev } from '../trace/tracer';
import { CELL_STATE, Scalar } from '../trace/types';
import { graphOf, nodeIdsOf, parseGraph, relabelNodes } from './graph';
import { computed, conceptual } from './checkpoints';
import { AlgorithmDef, RunFn } from './types';

const CPP = `vector<int> topoSort(vector<vector<int>>& adj, int n) {
    vector<int> indeg(n, 0);
    vector<int> out;
    queue<int> q;

    for (int u = 0; u < n; u++)
        for (int v : adj[u]) indeg[v]++;

    for (int u = 0; u < n; u++)
        if (indeg[u] == 0) q.push(u);

    while (!q.empty()) {
        int u = q.front();
        q.pop();
        out.push_back(u);

        for (int v : adj[u]) {
            indeg[v]--;

            if (indeg[v] == 0)
                q.push(v);
        }
    }

    return out;
}`;

const C = `void topoSort(int adj[][32], int deg[], int n, int out[], int* k) {
    int indeg[32] = {0};
    int q[1024];
    int head = 0, tail = 0;

    for (int u = 0; u < n; u++)
        for (int i = 0; i < deg[u]; i++) indeg[adj[u][i]]++;

    for (int u = 0; u < n; u++)
        if (indeg[u] == 0) q[tail++] = u;

    while (head < tail) {
        int u = q[head];
        head++;
        out[(*k)++] = u;

        for (int i = 0; i < deg[u]; i++) {
            int v = adj[u][i];  indeg[v]--;

            if (indeg[v] == 0)
                q[tail++] = v;
        }
    }

    return;
}`;

const JAVA = `List<Integer> topoSort(List<List<Integer>> adj, int n) {
    int[] indeg = new int[n];
    List<Integer> out = new ArrayList<>();
    Deque<Integer> q = new ArrayDeque<>();

    for (int u = 0; u < n; u++)
        for (int v : adj.get(u)) indeg[v]++;

    for (int u = 0; u < n; u++)
        if (indeg[u] == 0) q.addLast(u);

    while (!q.isEmpty()) {
        int u = q.peekFirst();
        q.pollFirst();
        out.add(u);

        for (int v : adj.get(u)) {
            indeg[v]--;

            if (indeg[v] == 0)
                q.addLast(v);
        }
    }

    return out;
}`;

const DEFAULT_EDGES = '0>2,1>2,2>3,2>4,3>5,4>5,1>4,5>6';

const run: RunFn = (input, t, mut) => {
  const text = graphOf(input, 'edges', DEFAULT_EDGES);
  const { nodes, edges, adj } = parseGraph(text, true);

  const indeg = new Map<string, number>();
  for (const n of nodes) indeg.set(n.id, 0);
  for (const e of edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);

  const out: Scalar[] = [];
  const queue: Scalar[] = [];
  const state: Record<string, number> = {};
  const overlay: Record<string, number | null> = {};
  let cursor: string | null = null;

  for (const n of nodes) {
    state[n.id] = CELL_STATE.unseen;
    overlay[n.id] = indeg.get(n.id) ?? 0;
  }

  t.graph('g', nodes, edges, {
    directed: true,
    layout: 'layered',
    state: () => state,
    overlay: () => overlay,
    cursor: () => cursor,
    label: 'graph — the number under each node is what it is still waiting for',
  });
  t.seq('queue', queue, 'queue', 'ready to go (nothing left waiting on)');
  t.seq('out', out, 'flow', 'order so far');
  t.aux('indeg', () => nodes.length);
  t.aux('queue', () => queue.length);

  const queueEarly = mut.has('queue-early');
  const noDecrement = mut.has('no-decrement');

  // Predecessors of each node, so the invariant can be stated without asking
  // the algorithm to vouch for itself.
  const preds = new Map<string, string[]>();
  for (const n of nodes) preds.set(n.id, []);
  for (const e of edges) preds.get(e.to)!.push(e.from);

  const recheck = () => {
    const emitted = new Set(out.map(String));
    // Two claims, and both are needed. "Every predecessor is already present"
    // is satisfied by an order that emits a node twice — which is not an order
    // at all — so the count has to be checked alongside the dependencies.
    let sound = emitted.size === out.length ? 1 : 0;
    for (const id of emitted) {
      if ((preds.get(id) ?? []).some((p) => !emitted.has(p))) sound = 0;
    }
    t.derive({ sound });
  };

  t.enter('topoSort', `topoSort(adj, ${nodes.length})`);
  t.step(2, { n: nodes.length, u: null, v: null, queued: 0, done: 0 }, 'Count, for every node, how many edges point at it.');

  for (const n of nodes) {
    t.step(6, { n: nodes.length, u: n.id, v: null, queued: 0, done: 0, indeg: indeg.get(n.id) ?? 0 }, `${n.id} is waited on by ${indeg.get(n.id) ?? 0} node${indeg.get(n.id) === 1 ? '' : 's'}.`);
  }

  for (const n of nodes) {
    const free = (indeg.get(n.id) ?? 0) === 0;
    t.step(9, { n: nodes.length, u: n.id, v: null, queued: queue.length, done: 0, indeg: indeg.get(n.id) ?? 0 }, free ? `${n.id} waits on nothing, so it can go first.` : `${n.id} still waits on ${indeg.get(n.id)}.`, ev.cmp({ kind: 'literal', value: indeg.get(n.id) ?? 0 }, '==', { kind: 'literal', value: 0 }, free));
    if (!free) continue;
    queue.push(n.id);
    state[n.id] = CELL_STATE.frontier;
    t.step(10, { n: nodes.length, u: n.id, v: null, queued: queue.length, done: 0 }, `Queue ${n.id}.`, ev.push('queue', n.id));
  }

  /** Edges followed. Each dependency is discharged exactly once. */
  let relaxed = 0;
  let guard = 0;
  while (queue.length > 0 && guard++ < 100_000) {
    t.step(12, { n: nodes.length, u: null, v: null, queued: queue.length, done: out.length }, `${queue.length} node${queue.length === 1 ? '' : 's'} ready.`, ev.cmp({ kind: 'var', name: 'queued' }, '>', { kind: 'literal', value: 0 }, true));

    const u = String(queue.shift());
    cursor = u;
    state[u] = CELL_STATE.visited;
    t.step(13, { n: nodes.length, u, v: null, queued: queue.length, done: out.length }, `Take ${u}.`, ev.visit('g', u));
    t.step(14, { n: nodes.length, u, v: null, queued: queue.length, done: out.length }, 'Remove it from the ready list.', ev.pop('queue', u));

    out.push(u);
    recheck();
    t.step(15, { n: nodes.length, u, v: null, queued: queue.length, done: out.length }, `${u} goes into the order. Everything it depends on is already there.`);

    for (const { to: v } of adj.get(u) ?? []) {
      relaxed++;
      if (!noDecrement) indeg.set(v, (indeg.get(v) ?? 0) - 1);
      overlay[v] = indeg.get(v) ?? 0;
      t.step(18, { n: nodes.length, u, v, queued: queue.length, done: out.length, indeg: indeg.get(v) ?? 0 }, noDecrement ? `${v} is not credited for ${u} being done — it still shows ${indeg.get(v)}.` : `${v} was waiting on ${u}. It is now waiting on ${indeg.get(v)}.`, ev.write('g', 0, indeg.get(v) ?? 0));

      const ready = queueEarly ? true : (indeg.get(v) ?? 0) === 0;
      t.step(20, { n: nodes.length, u, v, queued: queue.length, done: out.length, indeg: indeg.get(v) ?? 0 }, ready ? `${v} is ready.` : `${v} still waits on ${indeg.get(v)}.`, ev.cmp({ kind: 'literal', value: indeg.get(v) ?? 0 }, '==', { kind: 'literal', value: 0 }, (indeg.get(v) ?? 0) === 0));
      if (!ready) continue;

      queue.push(v);
      if (state[v] !== CELL_STATE.visited) state[v] = CELL_STATE.frontier;
      t.step(21, { n: nodes.length, u, v, queued: queue.length, done: out.length }, `Queue ${v}.`, ev.push('queue', v));
    }
  }

  cursor = null;
  t.step(12, { n: nodes.length, u: null, v: null, queued: 0, done: out.length }, 'Nothing is ready any more.', ev.cmp({ kind: 'var', name: 'queued' }, '>', { kind: 'literal', value: 0 }, false));
  t.exit();

  // Fewer nodes out than in means something was never freed, which on a
  // directed graph means a cycle — and a cycle has no topological order.
  const complete = out.length === nodes.length;
  // A short output is the right answer when there is a cycle and the wrong one
  // otherwise, so the claim has to tie the shortfall to a cycle that is really
  // there — found here by a separate walk rather than inferred from having run
  // out of work.
  // Edges *out of the nodes that were emitted*, not every edge in the graph:
  // on a cyclic graph the nodes inside the cycle never come off the queue, so
  // their edges are never followed and never should be.
  const emitted = new Set(out.map(String));
  const owed = edges.filter((e) => emitted.has(e.from)).length;
  t.derive({ accounted: complete || reallyCyclic(nodes, edges) ? 1 : 0, relaxed, owed });
  const answer = complete ? out.join(',') : `cycle: only ${out.length} of ${nodes.length} could be ordered`;
  t.step(25, { n: nodes.length, u: null, v: null, queued: 0, done: out.length }, complete ? `A valid order: ${answer}.` : answer);
  return answer;
};

/**
 * Whether the directed graph really contains a cycle.
 *
 * Kahn's algorithm detects one by running out of work, which is elegant and is
 * exactly what must not be reused here — a postcondition that reasons the same
 * way as the code it judges cannot catch the code reasoning wrongly. This peels
 * off zero-in-degree nodes independently and asks whether anything is left.
 */
function reallyCyclic(nodes: { id: string }[], edges: { from: string; to: string }[]): boolean {
  const indeg = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  for (const e of edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const out = new Set<string>();
  for (let pass = 0; pass < nodes.length; pass++) {
    const free = nodes.find((n) => !out.has(n.id) && (indeg.get(n.id) ?? 0) === 0);
    if (!free) break;
    out.add(free.id);
    for (const e of edges) {
      if (e.from === free.id) indeg.set(e.to, (indeg.get(e.to) ?? 0) - 1);
    }
  }
  return out.size !== nodes.length;
}

/** A directed chain of `n` nodes with forward shortcuts. Always acyclic. */
function dagOf(n: number): string {
  const parts: string[] = [];
  for (let i = 0; i < n - 1; i++) parts.push(`${i}>${i + 1}`);
  for (let i = 0; i + 3 < n; i += 3) parts.push(`${i}>${i + 3}`);
  return parts.join(',');
}

export const topologicalSort: AlgorithmDef = {
  slug: 'topological-sort',
  name: "Topological Sort (Kahn's)",
  category: 'graphs',
  tagline: 'Put tasks in an order where nothing comes before what it depends on.',
  intuition: [
    'The question is not "what order do I want" but "what order is even allowed". A node can go next only when everything pointing at it has already gone, so the algorithm keeps a count of what each node is still waiting for and takes whatever has reached zero.',
    'It is the same shape as breadth-first search with one extra rule, and the rule is where all the meaning is: a node joins the queue when its last dependency is removed, not when it is first reached. Reach a node early and you learn nothing; being reached is not the same as being ready.',
    'The failure case is the useful part. If the queue empties while nodes remain, those nodes are all waiting on each other — a cycle — and no valid order exists. The algorithm does not detect cycles as a separate step; running out of work is the detection.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'g',
    pointers: [],
    regions: [],
    invariant: {
      text: 'Every node in the order appears once, and only after all of its dependencies.',
      check: 'sound === 1',
      when: 'defined(sound)',
      why: 'This is the definition of a topological order, stated so it can be checked at every step rather than argued about at the end. Both halves earn their place: a node only reaches the queue when its waiting count hits zero, which is what puts dependencies first, and it reaches the queue exactly once, which is what stops it appearing twice. Queue a node the moment it is reached instead and the second half fails immediately — it gets queued once per incoming edge, and an order with a repeat in it is not an order.',
    },
    postcondition: {
      text: 'Either every node is in the order, or the graph really does contain a cycle.',
      check: 'accounted === 1',
      why: 'The invariant judges the prefix that has been emitted, and is satisfied by a run that stops after three nodes of eight. Reporting a cycle is the right answer when there is one and a wrong answer when there is not — so the claim has to tie the shortfall to an actual cycle rather than merely to having run out of work.',
    },
    cost: {
      text: 'Every edge out of an emitted node is followed exactly once: a dependency is discharged when its source is ordered, and never revisited.',
      check: 'relaxed === owed',
      why: 'Kahn’s algorithm looks like more bookkeeping than a plain traversal, and the counts are where that bookkeeping pays: each edge is decremented once, so the whole sort costs one pass over the graph rather than a re-scan for ready nodes. A version that rescanned would produce a valid order and would be quadratic, and the order it produced would not say so.',
    },
  },
  run,
  defaultInput: { edges: DEFAULT_EDGES },
  fields: [
    {
      key: 'edges',
      label: 'Dependencies',
      kind: 'text',
      help: 'Directed, like 0>2,1>2,2>3 — read "0 must come before 2". A cycle means no order exists, and the algorithm says so.',
    },
  ],
  validate: (input) => {
    const { nodes } = parseGraph(graphOf(input, 'edges', DEFAULT_EDGES), true);
    if (nodes.length === 0) return 'No nodes. Write at least one dependency, like 0>1.';
    if (nodes.length > 26) return 'Capped at 26 nodes here so the picture stays readable.';
    return null;
  },
  makeInput: (n) => ({ edges: dagOf(n) }),
  growthSizes: [16, 32, 64, 128, 256],
  projectTo: 1_000_000,
  complexity: {
    time: 'O(V + E) — O(n) in the node count, on the graphs measured here',
    space: 'O(V), which is O(n)',
    note: 'Each node is queued once and each edge is decremented once. The counts array is the only extra storage, and it is one number per node — which is why this is the standard answer even though it looks like it is doing more bookkeeping than a plain traversal.',
  },
  userLane: {
    fnName: 'topoSort',
    compareBy: 'return',
    binds: 'graph',
    graph: { directed: true, fallback: DEFAULT_EDGES },
    // A short order is the right answer on a graph with a cycle, and the
    // reference says so in words rather than by handing back a partial list —
    // so the reader's list is judged on its length and then spelled the same
    // way. The words are not a repair: a run that stops early on an acyclic
    // graph produces exactly this sentence and disagrees with the reference,
    // which reports an order.
    normalise: (returned, input, lane) => {
      const ids = nodeIdsOf(input, lane.graph!);
      const parts = returned === '' ? [] : returned.split(',');
      // Short means something was never freed, which on a directed graph means
      // a cycle — the reference's own words. Longer than the graph is neither,
      // so it is handed back as the list it is and disagrees on its own terms.
      return parts.length < ids.length
        ? `cycle: only ${parts.length} of ${ids.length} could be ordered`
        : relabelNodes(returned, ids);
    },
    starters: {
      cpp: `vector<int> topoSort(vector<vector<int>>& adj, int n) {
    vector<int> waiting(n, 0);
    vector<int> out;
    queue<int> q;

    for (int u = 0; u < n; u++)
        for (int k = 0; k < adj[u].size(); k++) waiting[adj[u][k]]++;

    for (int u = 0; u < n; u++)
        if (waiting[u] == 0) q.push(u);

    while (!q.empty()) {
        int u = q.front();
        q.pop();

        out.push_back(u);

        for (int k = 0; k < adj[u].size(); k++) {
            int v = adj[u][k];
            waiting[v]--;

            if (waiting[v] == 0)
                q.push(v);
        }
    }

    return out;
}`,
      c: `int* topoSort(int adj[][32], int deg[], int n) {
    int waiting[n];
    int room[n];
    int q[64];
    int head = 0, tail = 0, k = 0;

    for (int u = 0; u < n; u++)
        for (int i = 0; i < deg[u]; i++) waiting[adj[u][i]]++;

    for (int u = 0; u < n; u++)
        if (waiting[u] == 0) {
            q[tail] = u;
            tail = tail + 1;
        }

    while (head < tail) {
        int u = q[head];
        head = head + 1;

        room[k] = u;
        k = k + 1;

        for (int i = 0; i < deg[u]; i++) {
            int v = adj[u][i];
            waiting[v]--;

            if (waiting[v] == 0) {
                q[tail] = v;
                tail = tail + 1;
            }
        }
    }

    int out[k];
    for (int i = 0; i < k; i++) out[i] = room[i];
    return out;
}`,
      java: `List<Integer> topoSort(int[][] adj, int n) {
    int[] waiting = new int[n];
    List<Integer> out = new ArrayList<>();
    Deque<Integer> q = new ArrayDeque<>();

    for (int u = 0; u < n; u++)
        for (int k = 0; k < adj[u].length; k++) waiting[adj[u][k]]++;

    for (int u = 0; u < n; u++)
        if (waiting[u] == 0) q.addLast(u);

    while (!q.isEmpty()) {
        int u = q.peekFirst();
        q.pollFirst();

        out.add(u);

        for (int k = 0; k < adj[u].length; k++) {
            int v = adj[u][k];
            waiting[v]--;

            if (waiting[v] == 0)
                q.addLast(v);
        }
    }

    return out;
}`,
      js: `function topoSort(adj, n) {
  let waiting = new Array(n).fill(0);
  let out = [];
  let q = [];

  for (let u = 0; u < n; u++)
    for (let k = 0; k < adj[u].length; k++) waiting[adj[u][k]]++;

  for (let u = 0; u < n; u++) if (waiting[u] === 0) q.push(u);

  while (q.length > 0) {
    let u = q.shift();
    out.push(u);

    for (let k = 0; k < adj[u].length; k++) {
      let v = adj[u][k];
      waiting[v]--;

      if (waiting[v] === 0) q.push(v);
    }
  }

  return out;
}`,
    },
  },
  mutations: [
    {
      id: 'queue-early',
      edits: [
        { line: 20, from: 'if (indeg[v] == 0)', to: 'if (true)', langs: ['cpp', 'java'] },
        { line: 20, from: 'if (indeg[v] == 0)', to: 'if (1)', langs: ['c'] },
      ],
      label: 'queue on first sight',
      note: 'Queues a node as soon as it is reached, rather than when it is ready.',
    },
    {
      id: 'no-decrement',
      edits: [
        { line: 18, from: 'indeg[v]--;', to: '// indeg[v]--;', langs: ['cpp', 'java'] },
        { line: 18, from: 'int v = adj[u][i];  indeg[v]--;', to: 'int v = adj[u][i];  // indeg[v]--;', langs: ['c'] },
      ],
      label: 'never decrement',
      note: 'Nothing is ever credited for a finished dependency, so nothing new becomes ready.',
    },
  ],
  variants: [
    {
      id: 'queue-early',
      label: 'Queues a node the first time it is seen',
      blurb: 'Produces an order, and the order is wrong.',
      explanation:
        'Being reached and being ready are different things, and this confuses them. A node with two dependencies gets queued when the first one finishes, so it can be emitted while the second is still outstanding — which is exactly the constraint the order exists to respect. It also emits some nodes twice, because they are queued once per incoming edge. Nothing crashes; the output just is not a topological order.',
      mutations: ['queue-early'],
    },
    {
      id: 'no-decrement',
      label: 'Never decrements the waiting count',
      blurb: 'Emits the nodes that started free, then stops.',
      explanation:
        'The counts never fall, so nothing ever becomes ready and the queue empties after the initial batch. The interesting part is what the algorithm concludes: fewer nodes came out than went in, which is precisely the signal it uses to report a cycle. It reports a cycle in a graph that has none — a wrong answer arrived at by correct reasoning from a broken measurement.',
      mutations: ['no-decrement'],
    },
  ],
  edgeCases: [
    { id: 'default', label: 'The default graph', input: { edges: DEFAULT_EDGES }, why: 'Node 2 waits on two others, which is the case queueing early gets wrong.' },
    { id: 'chain', label: 'A straight chain', input: { edges: '0>1,1>2,2>3,3>4' }, why: 'Only one valid order exists. Every node has exactly one dependency, so queueing early looks correct here.' },
    { id: 'cycle', label: 'A cycle', input: { edges: '0>1,1>2,2>0' }, why: 'No order exists. Nothing ever reaches a count of zero, so the queue is empty from the start.' },
    { id: 'partial-cycle', label: 'A cycle plus free nodes', input: { edges: '0>1,2>3,3>4,4>2' }, why: 'Nodes 0 and 1 can be ordered; 2, 3 and 4 cannot. The count of what came out is how that is noticed.' },
    { id: 'diamond', label: 'A diamond', input: { edges: '0>1,0>2,1>3,2>3' }, why: 'Two valid orders. A topological sort finds one of them, not all of them.' },
    { id: 'independent', label: 'No edges at all', input: { edges: '0,1,2,3' }, why: 'Everything is free immediately, so any order is valid and the queue starts full.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 20, nth: 2 },
      question: 'Why does a node join the queue when its count hits zero, rather than when it is first reached?',
      options: [
        'Because being reached is not the same as having no dependencies left',
        'To keep the queue smaller',
        'Because reaching it twice would be an error',
        'It makes no difference on a valid graph',
      ],
      answer: 'Because being reached is not the same as having no dependencies left',
      because:
        'A node with three prerequisites is reached three times and is only ready on the third. Queueing on first sight emits it while two prerequisites are outstanding — which is the exact constraint the ordering exists to respect — and queues it three times over.',
    }),
    computed({
      where: { line: 15, nth: 1 },
      question: () => 'The first node has just been emitted. What was special about it?',
      answer: () => 'Nothing pointed at it',
      options: (a) => [
        a,
        'It had the lowest number',
        'It had the most outgoing edges',
        'It was the first one written in the input',
      ],
      because:
        'Only nodes with an in-degree of zero can go first, because anything with a predecessor has to wait for it. If no such node exists, every node is waiting on another and the graph has a cycle — which is why an empty starting queue is not an edge case but the answer.',
    }),
    conceptual({
      where: { line: 12, nth: -1 },
      question: 'The queue has emptied. How does the algorithm tell a finished sort from a cycle?',
      options: [
        'By comparing how many nodes came out with how many went in',
        'By checking every remaining count',
        'By searching for a cycle explicitly',
        'It cannot tell the difference',
      ],
      answer: 'By comparing how many nodes came out with how many went in',
      because:
        'Nothing here looks for a cycle. A node in a cycle is always waiting on another node in that cycle, so its count never reaches zero and it never joins the queue — and the shortfall in the output is the detection. One counter does the work of a second traversal.',
    }),
  ],
};
