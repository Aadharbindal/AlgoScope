import { graphOf, parseGraph } from '../algorithms/graph';
import { buildBst } from '../algorithms/tree';
import { Input, LaneBinding, UserLane } from '../algorithms/types';

/**
 * What the reader's parameters receive.
 *
 * Every lane on this site hands the reader a real structure — an array, a
 * linked list, a tree of nodes, a maze, an adjacency list — rather than asking
 * them to build one first. Building the input is a different exercise from the
 * one the page is about, and a duller one.
 *
 * The rule for *which* parameter gets *what* is stated rather than guessed:
 * each lane declares an ordered list of slots, each slot names the parameter
 * names that claim it, and a parameter that matches nothing takes the next
 * unclaimed slot in order. That is what lets one lane accept all three
 * languages' natural signatures without the reader having to learn a
 * convention — and the editor prints the same list underneath the box, so it
 * is never a surprise.
 */

/** A value handed to one parameter, in plain JavaScript. */
export type Bound = number | string | null | JsNode | Bound[];

/** A node of a linked list or a binary tree, as the reader's code sees it. */
export interface JsNode {
  [field: string]: Bound;
}

export interface Slot {
  /** Parameter names that claim this slot outright. */
  names: RegExp;
  /** What the parameter is called in the starters, for the editor's note. */
  as: string;
  /** What it holds, in one phrase. */
  is: string;
  value: (input: Input, lane: UserLane) => Bound;
}

/* ------------------------------------------------------------------ */
/* The shapes themselves.                                             */

const numbers = (input: Input): number[] => (input.array ?? []).slice();

/**
 * The input array as a chain of nodes.
 *
 * A `target` is read as the index the last node links back to, which is how
 * the cycle-detection page has always described its input — and which is what
 * lets a reader write a real cycle detector against a list that really has one.
 * A negative target means no cycle.
 */
export function buildChain(input: Input): JsNode | null {
  const values = numbers(input);
  if (values.length === 0) return null;

  const nodes: JsNode[] = values.map((val) => ({ val, next: null }));
  for (let i = 0; i + 1 < nodes.length; i++) nodes[i].next = nodes[i + 1];

  const link = typeof input.target === 'number' ? input.target : -1;
  if (link >= 0 && link < nodes.length) nodes[nodes.length - 1].next = nodes[link];
  return nodes[0];
}

/** The input array as a binary search tree, inserted in the order given. */
export function buildTree(input: Input): JsNode | null {
  const { nodes, root } = buildBst(numbers(input));
  if (root === null) return null;

  const made = new Map<string, JsNode>();
  for (const [id, n] of nodes) made.set(id, { val: n.value, left: null, right: null });
  for (const [id, n] of nodes) {
    const node = made.get(id)!;
    node.left = n.left === null ? null : made.get(n.left)!;
    node.right = n.right === null ? null : made.get(n.right)!;
  }
  return made.get(root)!;
}

/** The maze as a rectangle of ints, 1 for a wall — the same shape it is drawn from. */
export function buildGrid(input: Input): number[][] {
  const g = input.grid;
  if (!Array.isArray(g) || g.length === 0) return [[0]];
  return (g as number[][]).map((row) => row.map((v) => (v ? 1 : 0)));
}

/**
 * The graph as an adjacency list of indices.
 *
 * Node *indices*, not the names in the text: a function returning
 * `vector<int>` cannot return the name "b", and asking a reader to carry
 * strings around would be teaching a detail of this website rather than an
 * algorithm. Index i is the i-th node mentioned in the edge list, and the
 * neighbours of each node stay in first-mention order — which is not
 * cosmetic, since it decides which branch a depth-first walk takes first.
 */
export function buildAdj(input: Input, lane: UserLane): { adj: number[][]; wt: number[][]; ids: string[] } {
  const spec = lane.graph ?? { directed: false, fallback: '0-1' };
  const { nodes, adj } = parseGraph(graphOf(input, 'edges', spec.fallback), spec.directed);
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  return {
    ids: nodes.map((n) => n.id),
    adj: nodes.map((n) => (adj.get(n.id) ?? []).map((e) => index.get(e.to)!)),
    wt: nodes.map((n) => (adj.get(n.id) ?? []).map((e) => e.weight)),
  };
}

const wordOf = (input: Input, key: string): string => {
  const v = input[key];
  return typeof v === 'string' ? v : '';
};

/* ------------------------------------------------------------------ */
/* The slot tables, one per binding.                                  */

const ARRAY_SLOTS: Slot[] = [
  { names: /^(arr|a|nums|xs|v|data|list)$/i, as: 'arr', is: 'the input array', value: numbers },
  { names: /^(n|size|len|length|count|sz)$/i, as: 'n', is: 'its length', value: (i) => numbers(i).length },
  { names: /^(target|key|x|value|val|find|goal)$/i, as: 'target', is: 'the target', value: (i) => i.target ?? 0 },
  { names: /^(lo|low|left|l|start|begin|first)$/i, as: 'lo', is: '0', value: () => 0 },
  { names: /^(hi|high|right|r|end|last)$/i, as: 'hi', is: 'the last index', value: (i) => numbers(i).length - 1 },
];

const LIST_SLOTS: Slot[] = [
  { names: /^(head|root|node|list|start|curr)$/i, as: 'head', is: 'the first node of the list', value: buildChain },
  ...ARRAY_SLOTS.slice(1),
];

const TREE_SLOTS: Slot[] = [
  { names: /^(root|node|tree|head)$/i, as: 'root', is: 'the root node, with val, left and right', value: buildTree },
];

const GRID_SLOTS: Slot[] = [
  { names: /^(g|grid|maze|cells|board)$/i, as: 'g', is: 'the maze, 1 for a wall', value: buildGrid },
  { names: /^(rows|nr|r|n|h|height)$/i, as: 'rows', is: 'its height', value: (i) => buildGrid(i).length },
  { names: /^(cols|nc|c|m|w|width)$/i, as: 'cols', is: 'its width', value: (i) => buildGrid(i)[0].length },
];

const GRAPH_SLOTS: Slot[] = [
  {
    names: /^(adj|graph|g|neighbours|neighbors)$/i,
    as: 'adj',
    is: 'the adjacency list — adj[u] holds the indices of u’s neighbours',
    value: (i, lane) => buildAdj(i, lane).adj,
  },
  {
    names: /^(deg|degree|degrees|len|lens|counts)$/i,
    as: 'deg',
    is: 'how many neighbours each node has — deg[u], which C needs and C++ reads off adj[u]',
    value: (i, lane) => buildAdj(i, lane).adj.map((row) => row.length),
  },
  {
    names: /^(n|size|count|nodes|v)$/i,
    as: 'n',
    is: 'the number of nodes',
    value: (i, lane) => buildAdj(i, lane).adj.length,
  },
  {
    names: /^(src|source|start|s|from)$/i,
    as: 'src',
    is: '0, the first node mentioned in the edge list',
    value: () => 0,
  },
];

const WEIGHTED_SLOTS: Slot[] = [
  GRAPH_SLOTS[0],
  {
    names: /^(wt|w|weight|weights|cost|costs)$/i,
    as: 'wt',
    is: 'the weights, laid out beside adj — wt[u][k] is what adj[u][k] costs',
    value: (i, lane) => buildAdj(i, lane).wt,
  },
  ...GRAPH_SLOTS.slice(1),
];

const WORD_SLOTS: Slot[] = [
  { names: /^(a|word1|s1|s|from|first)$/i, as: 'a', is: 'the word being edited', value: (i) => wordOf(i, 'word1') },
  { names: /^(b|word2|s2|t|to|second)$/i, as: 'b', is: 'the word it has to become', value: (i) => wordOf(i, 'word2') },
  { names: /^(n|len1)$/i, as: 'n', is: 'the length of a', value: (i) => wordOf(i, 'word1').length },
  { names: /^(m|len2)$/i, as: 'm', is: 'the length of b', value: (i) => wordOf(i, 'word2').length },
];

const TABLE: Record<LaneBinding, Slot[]> = {
  array: ARRAY_SLOTS,
  list: LIST_SLOTS,
  tree: TREE_SLOTS,
  grid: GRID_SLOTS,
  graph: GRAPH_SLOTS,
  weighted: WEIGHTED_SLOTS,
  words: WORD_SLOTS,
};

export const slotsFor = (lane: UserLane): Slot[] => TABLE[lane.binds ?? 'array'];

/**
 * Fill each parameter, by name where the name is recognised and by position
 * otherwise.
 *
 * A parameter that claims no slot and finds none left is handed the target,
 * which is what this did before there was more than one shape of input — a
 * reader who adds a scratch parameter gets a number rather than an error about
 * a convention they did not know existed.
 */
export function chooseSlots(params: string[], lane: UserLane): (Slot | null)[] {
  const slots = slotsFor(lane);
  const taken = new Set<number>();
  const chosen: (Slot | null)[] = params.map(() => null);

  params.forEach((p, i) => {
    const at = slots.findIndex((s, k) => !taken.has(k) && s.names.test(p));
    if (at >= 0) {
      taken.add(at);
      chosen[i] = slots[at];
    }
  });

  params.forEach((_, i) => {
    if (chosen[i]) return;
    const at = slots.findIndex((_s, k) => !taken.has(k));
    if (at < 0) return;
    taken.add(at);
    chosen[i] = slots[at];
  });

  return chosen;
}

export function bindArgs(params: string[], input: Input, lane: UserLane): Bound[] {
  return chooseSlots(params, lane).map((slot) =>
    slot ? slot.value(input, lane) : (input.target ?? 0),
  );
}

/**
 * Whether the array belongs on the stage.
 *
 * The input array is what the reader's code works on in an array lane, and it
 * is the contents of the list in a linked-list one. In a tree lane it is the
 * *insertion order* — the recipe the tree was built from, not anything the
 * function holds — and in a grid, graph or word lane it is empty. Drawing it
 * anyway would put a row of cells beside code that never touches them.
 */
export const drawsArray = (lane: UserLane) => {
  const binds = lane.binds ?? 'array';
  return binds === 'array' || binds === 'list';
};

/** The sentence the editor prints under the box, naming what each parameter gets. */
export const bindingNote = (lane: UserLane): string =>
  slotsFor(lane)
    .map((s) => `${s.as} is ${s.is}`)
    .join('; ') + '.';
