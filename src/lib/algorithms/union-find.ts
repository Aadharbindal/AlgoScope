import { ev } from '../trace/tracer';
import { CELL_STATE } from '../trace/types';
import { graphOf, parseGraph } from './graph';
import { computed, conceptual } from './checkpoints';
import { AlgorithmDef, RunFn } from './types';

/**
 * A structure whose whole cost argument is about shape.
 *
 * Every other algorithm on this site is judged on the answer it returns.
 * Union-find returns a number that is easy to get right by accident — count
 * the components — while doing it in a way that is quadratic instead of nearly
 * constant. What separates the two is the *height of the trees it builds*, and
 * nothing about the count says which one happened.
 *
 * That makes it the clearest case in the catalogue for the third kind of
 * claim, and the reason it is worth having even though a plain traversal
 * answers the same question.
 */

const DEFAULT_EDGES = '0-1,2-3,0-2,3-4,4-5,5-6';

const CPP = `int find(vector<int>& parent, int x) {
    while (parent[x] != x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
    }
    return x;
}

int components(vector<vector<int>>& edges, int n) {
    vector<int> parent(n), size(n, 1);
    for (int i = 0; i < n; i++) parent[i] = i;
    int count = n;

    for (auto& e : edges) {
        int a = find(parent, e[0]), b = find(parent, e[1]);
        if (a == b) continue;

        if (size[a] < size[b]) swap(a, b);
        parent[b] = a;
        size[a] = size[a] + size[b];
        count--;
    }

    return count;
}`;

const C = `int find(int parent[], int x) {
    while (parent[x] != x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
    }
    return x;
}

int components(int edges[][2], int m, int n) {
    int parent[64], size[64];
    for (int i = 0; i < n; i++) { parent[i] = i; size[i] = 1; }
    int count = n;

    for (int k = 0; k < m; k++) {
        int a = find(parent, edges[k][0]), b = find(parent, edges[k][1]);
        if (a == b) continue;

        if (size[a] < size[b]) { int t = a; a = b; b = t; }
        parent[b] = a;
        size[a] = size[a] + size[b];
        count--;
    }

    return count;
}`;

const JAVA = `int find(int[] parent, int x) {
    while (parent[x] != x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
    }
    return x;
}

int components(int[][] edges, int n) {
    int[] parent = new int[n], size = new int[n];
    for (int i = 0; i < n; i++) { parent[i] = i; size[i] = 1; }
    int count = n;

    for (int[] e : edges) {
        int a = find(parent, e[0]), b = find(parent, e[1]);
        if (a == b) continue;

        if (size[a] < size[b]) { int t = a; a = b; b = t; }
        parent[b] = a;
        size[a] = size[a] + size[b];
        count--;
    }

    return count;
}`;

interface Opts {
  /** The buggy version attaches the larger tree under the smaller one. */
  bySize: boolean;
  /** The buggy version leaves the path uncompressed on the way up. */
  compress: boolean;
}

/** Components counted the obvious way, for the postcondition to lean on. */
function reallyComponents(n: number, edges: [number, number][]): number {
  const near = new Map<number, number[]>();
  for (let i = 0; i < n; i++) near.set(i, []);
  for (const [a, b] of edges) {
    near.get(a)?.push(b);
    near.get(b)?.push(a);
  }
  const seen = new Set<number>();
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (seen.has(i)) continue;
    count++;
    const queue = [i];
    seen.add(i);
    for (let h = 0; h < queue.length; h++) {
      for (const next of near.get(queue[h]) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return count;
}

function makeRun(opts: Opts): RunFn {
  return (input, t) => {
    const text = graphOf(input, 'edges', DEFAULT_EDGES);
    const { nodes, edges: parsed } = parseGraph(text, false);
    const n = nodes.length;
    const index = new Map(nodes.map((node, i) => [node.id, i]));
    const pairs: [number, number][] = parsed.map((e) => [index.get(e.from)!, index.get(e.to)!]);

    const parent = Array.from({ length: n }, (_, i) => i);
    const size = Array.from({ length: n }, () => 1);
    let count = n;

    const state: Record<string, number> = {};
    const overlay: Record<string, number | null> = {};
    let cursor: string | null = null;

    /** Parent hops taken, and the height the forest was allowed to reach. */
    let hops = 0;
    let tallest = 0;
    /** Pointers moved nearer the leader while walking — path halving, counted. */
    let rewrites = 0;

    const rootOf = (x: number) => {
      let at = x;
      let guard = n + 2;
      while (parent[at] !== at && guard-- > 0) at = parent[at];
      return at;
    };

    /** How far from a root the deepest node currently sits. */
    const height = () => {
      let worst = 0;
      for (let i = 0; i < n; i++) {
        let d = 0;
        let at = i;
        let guard = n + 2;
        while (parent[at] !== at && guard-- > 0) {
          at = parent[at];
          d++;
        }
        worst = Math.max(worst, d);
      }
      return worst;
    };

    const refresh = () => {
      for (let i = 0; i < n; i++) {
        overlay[nodes[i].id] = rootOf(i);
        state[nodes[i].id] = rootOf(i) === i ? CELL_STATE.visited : CELL_STATE.frontier;
      }
    };

    const mark = () => {
      if (!t.tracing) return;
      tallest = Math.max(tallest, height());
      t.derive({
        // Every node reaches a root by following parents. A forest that has
        // grown a cycle would never terminate, so this is the claim that the
        // structure is still a forest at all.
        forest: [...Array(n)].every((_, i) => parent[rootOf(i)] === rootOf(i)) ? 1 : 0,
        height: height(),
        count,
      });
    };

    t.graph('g', nodes, parsed, {
      directed: false,
      layout: 'circle',
      state: () => state,
      overlay: () => overlay,
      cursor: () => cursor,
      label: 'graph',
    });
    // The parent array is the structure. Without it on the stage the two
    // rules are invisible — both leave the leaders unchanged, and it is only
    // the chain of arrows underneath that grows.
    t.array('parent', parent, 'parent — each node’s next step towards its leader');
    t.aux('parent', () => n * 2);
    t.oracle({ truly: reallyComponents(n, pairs) });

    t.enter('components', `components(edges, ${n})`);
    refresh();
    mark();
    t.step(11, { n, a: null, b: null, count }, `${n} node${n === 1 ? '' : 's'}, each its own component to begin with. Every edge that joins two different ones removes a component.`, ev.call('components', `components(edges, ${n})`));

    for (const [ea, eb] of pairs) {
      cursor = nodes[ea]?.id ?? null;
      t.step(15, { n, a: ea, b: eb, count }, `Edge ${nodes[ea].id}–${nodes[eb].id}.`);
      t.tick();

      // find, on both ends
      let a = ea;
      let depthA = 0;
      while (parent[a] !== a) {
        hops++;
        depthA++;
        if (opts.compress) {
          rewrites++;
          parent[a] = parent[parent[a]];
        }
        a = parent[a];
      }
      let b = eb;
      let depthB = 0;
      while (parent[b] !== b) {
        hops++;
        depthB++;
        if (opts.compress) {
          rewrites++;
          parent[b] = parent[parent[b]];
        }
        b = parent[b];
      }
      refresh();
      mark();
      t.step(15, { n, a, b, count }, `${nodes[ea].id} is in the group led by ${nodes[a].id} (${depthA} hop${depthA === 1 ? '' : 's'} up); ${nodes[eb].id} is led by ${nodes[b].id} (${depthB}).`, ev.visit('g', nodes[a].id));

      const already = a === b;
      t.step(16, { n, a, b, count }, already ? `Both ends already lead to ${nodes[a].id}, so this edge joins nothing new.` : `Different leaders, so this edge really does join two components.`, ev.cmp({ kind: 'var', name: 'a' }, '==', { kind: 'var', name: 'b' }, already));
      if (already) continue;

      let big = a;
      let small = b;
      if (opts.bySize ? size[big] < size[small] : size[big] > size[small]) {
        big = b;
        small = a;
      }
      t.step(18, { n, a: big, b: small, count }, opts.bySize ? `${nodes[big].id}'s group has ${size[big]} node${size[big] === 1 ? '' : 's'} and ${nodes[small].id}'s has ${size[small]}, so the smaller goes under the larger.` : `Attach ${nodes[small].id}'s group under ${nodes[big].id}'s without comparing their sizes.`);

      parent[small] = big;
      size[big] += size[small];
      count--;
      refresh();
      mark();
      t.step(19, { n, a: big, b: small, count }, `${nodes[small].id} now points at ${nodes[big].id}. ${count} component${count === 1 ? '' : 's'} left.`, ev.link(nodes[small].id, nodes[big].id));
    }

    cursor = null;
    refresh();
    t.derive({
      forest: 1,
      height: height(),
      count,
      answerOk: count === reallyComponents(n, pairs) ? 1 : 0,
      tallest,
      allowed: Math.max(1, Math.floor(Math.log2(Math.max(1, n))) + 1),
      hops,
      rewrites,
    });
    t.step(23, { n, a: null, b: null, count }, `${count} component${count === 1 ? '' : 's'}.`, ev.ret('components', count));
    t.exit();
    return count;
  };
}

const run: RunFn = (input, t, mut) =>
  makeRun({ bySize: !mut.has('ignore-size'), compress: !mut.has('no-compress') })(input, t, mut);

export const unionFind: AlgorithmDef = {
  slug: 'union-find',
  name: 'Union-Find (Disjoint Sets)',
  category: 'graphs',
  tagline: 'Keep one leader per group, and always hang the smaller group under the larger.',
  intuition: [
    'The question is which things are in the same group, when groups keep merging. Every node starts alone and points at itself. To merge two groups, make one leader point at the other.',
    'Asking "are these two together?" then means walking up from each to its leader and comparing. The whole performance of the structure is therefore about one thing: how far that walk is.',
    'Two rules keep it short, and both are easy to leave out. Hang the smaller group under the larger, so the deep side never grows deeper. And on the way up, point each node you pass at its grandparent — the path you just walked gets shorter for everyone who walks it again.',
    'Leave either rule out and the answer is exactly the same, every time. What changes is that the trees grow tall and each query costs a walk down them. That is why this page measures the height of the forest rather than only checking the count.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'g',
    pointers: [],
    regions: [],
    invariant: {
      text: 'Following parents from any node reaches a leader — the structure is a forest, never a ring.',
      check: 'forest === 1',
      when: 'defined(forest)',
      why: 'Every operation here is a walk upwards, so the one thing that must never happen is a cycle in the parent links: a walk that goes round forever is not a slow answer, it is no answer. Attaching a root under a node in its own tree does exactly that, which is why the union step is written to join two *roots* and not two nodes.',
    },
    postcondition: {
      text: 'The count is the number of groups the edges really form.',
      check: 'answerOk === 1',
      why: 'Checked by a plain flood fill over the same edges — the traversal this structure exists to avoid re-running after every change. That is what makes it a fair check: it is the obvious method, computed separately, and it does not share a single line with the thing it is judging.',
    },
    cost: {
      text: 'The forest stays log n tall, and every hop of a walk moves the node it passes nearer to the leader.',
      check: 'tallest <= allowed && rewrites === hops',
      why: 'This is the entire structure. Both of its rules — hang the smaller under the larger, and shorten the path as you walk it — exist only to keep this true, and neither of them changes a single answer. Remove either one and the count comes back correct on every input while the trees grow into chains and each question costs a walk down one. There is no way to see that in the result; the height is the only place it lives.',
    },
  },
  run,
  defaultInput: { edges: DEFAULT_EDGES },
  fields: [
    {
      key: 'edges',
      label: 'Edges',
      kind: 'text',
      help: 'Comma-separated, like 0-1,1-2,3-4. Each edge merges the groups its ends are in. A bare name adds a node in a group of its own.',
    },
  ],
  makeInput: (n) => {
    const parts: string[] = [];
    for (let i = 0; i + 1 < n; i++) parts.push(`${i}-${i + 1}`);
    return { edges: parts.join(',') };
  },
  growthSizes: [16, 32, 64, 128, 256],
  projectTo: 100_000,
  complexity: {
    time: 'O(n) — very nearly constant per operation, on the graphs measured here',
    space: 'O(n), which is the two arrays',
    note: 'The true bound involves the inverse Ackermann function, which is below five for any input that fits in a computer — so "effectively constant per operation" is the honest summary and the measurement here cannot tell it apart from constant. What the measurement *can* show is what happens without the two rules: switch either mutation on and watch the same count cost a different shape of work.',
  },
  mutations: [
    {
      id: 'ignore-size',
      edits: [
        { line: 18, from: 'if (size[a] < size[b]) swap(a, b);', to: '// if (size[a] < size[b]) swap(a, b);', langs: ['cpp'] },
        { line: 18, from: 'if (size[a] < size[b]) { int t = a; a = b; b = t; }', to: '/* no size comparison */', langs: ['c', 'java'] },
      ],
      label: 'ignore the group sizes',
      note: 'Always attaches the second root under the first, whichever is deeper.',
    },
    {
      id: 'no-compress',
      edits: [
        { line: 3, from: '        parent[x] = parent[parent[x]];', to: '        // parent[x] = parent[parent[x]];', langs: ['cpp', 'java'] },
        { line: 3, from: '        parent[x] = parent[parent[x]];', to: '        /* no compression */;', langs: ['c'] },
      ],
      label: 'never shorten the path',
      note: 'Walks to the leader without pointing anything at its grandparent on the way.',
    },
  ],
  variants: [
    {
      id: 'ignore-size',
      label: 'The sizes are never compared',
      blurb: 'The count is right and the trees grow into chains.',
      explanation:
        'Hanging a large group under a small one adds a level to everything in the large group. Do it repeatedly and the forest becomes a single long chain, so every later question walks its whole length. The number of components is completely unaffected — merging is merging, whichever way round the arrow points — which is why the height is the only place this shows.',
      mutations: ['ignore-size'],
    },
    {
      id: 'no-compress',
      label: 'The path is never shortened',
      blurb: 'Every walk to a leader is as long as the last one.',
      explanation:
        'Pointing each node you pass at its grandparent costs nothing extra — you are walking past it anyway — and halves the path for everyone who walks it later. Without it the work already done is thrown away at the end of every query, so the same walk is repeated as often as it is asked for. Again the count is untouched.',
      mutations: ['no-compress'],
    },
  ],
  edgeCases: [
    { id: 'default', label: 'The default graph', input: { edges: DEFAULT_EDGES }, why: 'Two pairs merged into one group and then extended — deep enough that a walk really does climb, which is what both rules exist to prevent and what neither of them changes about the answer.' },
    { id: 'chain', label: 'A single chain', input: { edges: '0-1,1-2,2-3,3-4,4-5' }, why: 'Everything ends up in one group. Without union by size this is the input that builds the tallest possible tree.' },
    { id: 'star', label: 'A star', input: { edges: '0-1,0-2,0-3,0-4' }, why: 'Every edge attaches a single node to a growing group, so the size rule matters from the second edge onwards.' },
    { id: 'isolated', label: 'No edges at all', input: { edges: '0,1,2,3' }, why: 'Four nodes and no merges. Every node is its own leader and the answer is the node count.' },
    { id: 'redundant', label: 'Every edge repeated', input: { edges: '0-1,0-1,0-1' }, why: 'Only the first edge merges anything. The other two find the same leader on both ends and change nothing.' },
    { id: 'triangle', label: 'A triangle', input: { edges: '0-1,1-2,2-0' }, why: 'Three edges, two merges, one group. The third edge is where the equal-leaders check earns its place.' },
    { id: 'single', label: 'One edge', input: { edges: '0-1' }, why: 'The smallest merge there is.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 16, nth: 2 },
      question: 'Both ends of this edge lead to the same node, so it is skipped. What would go wrong if it were not?',
      options: [
        'A tree would be attached under itself, making a ring that no walk escapes',
        'The count would be one too high',
        'Nothing — the check is only an optimisation',
        'The two groups would be merged twice',
      ],
      answer: 'A tree would be attached under itself, making a ring that no walk escapes',
      because:
        'Pointing a root at a node inside its own tree closes a loop in the parent links, and every walk upwards from there runs forever. It is the one way this structure can fail outright rather than merely slowly, which is why the check comes before the merge and not after it.',
    }),
    conceptual({
      where: { line: 18, nth: 2 },
      question: 'Why hang the smaller group under the larger rather than the other way round?',
      options: [
        'Because it adds a level to fewer nodes',
        'Because the larger group is more likely to be asked about',
        'Because it keeps the leader’s index small',
        'It makes no difference to anything',
      ],
      answer: 'Because it adds a level to fewer nodes',
      because:
        'Attaching a group deepens every node in it by one. Deepening the smaller group is strictly the cheaper of the two choices, and doing it every time is what bounds the height at log n: a tree can only double in size each time it gets taller.',
    }),
    computed({
      where: { line: 19, nth: 2 },
      question: () => 'How many components are left after this merge?',
      answer: (step) => String(step.vars.count ?? 0),
      options: (answer) => {
        const c = Number(answer);
        return [String(c), String(c + 1), String(Math.max(0, c - 1)), '1'];
      },
      because:
        'Every merge joins two groups into one, so the count falls by exactly one — never by two, and never at all for an edge whose ends were already together. Starting from one group per node, the count is the node count minus the number of merges that actually happened.',
    }),
  ],
};
