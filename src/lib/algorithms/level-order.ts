import { ev } from '../trace/tracer';
import { CELL_STATE, Scalar } from '../trace/types';
import { balancedOrder, buildBst } from './tree';
import { computed, conceptual } from './checkpoints';
import { AlgorithmDef, RunFn } from './types';

const CPP = `vector<int> levelOrder(Node* root) {
    vector<int> out;
    queue<Node*> q;

    if (root != nullptr)
        q.push(root);

    while (!q.empty()) {
        Node* node = q.front();
        q.pop();

        out.push_back(node->val);

        if (node->left != nullptr)
            q.push(node->left);

        if (node->right != nullptr)
            q.push(node->right);
    }

    return out;
}`;

const C = `void levelOrder(struct Node* root, int out[], int* k) {
    struct Node* q[256];
    int head = 0, tail = 0;

    if (root != NULL)
        q[tail++] = root;

    while (head < tail) {
        struct Node* node = q[head];
        head++;

        out[(*k)++] = node->val;

        if (node->left != NULL)
            q[tail++] = node->left;

        if (node->right != NULL)
            q[tail++] = node->right;
    }

    return;
}`;

const JAVA = `List<Integer> levelOrder(Node root) {
    List<Integer> out = new ArrayList<>();
    Deque<Node> q = new ArrayDeque<>();

    if (root != null)
        q.addLast(root);

    while (!q.isEmpty()) {
        Node node = q.peekFirst();
        q.pollFirst();

        out.add(node.val);

        if (node.left != null)
            q.addLast(node.left);

        if (node.right != null)
            q.addLast(node.right);
    }

    return out;
}`;

const run: RunFn = (input, t, mut) => {
  const values = (input.array ?? []).slice();
  const { nodes, root } = buildBst(values);

  const out: Scalar[] = [];
  const queue: Scalar[] = [];
  const state: Record<string, number> = {};

  t.tree('tree', nodes, root, { state: () => state, label: 'tree' });
  t.seq('queue', queue, 'queue', 'queue (front on the left)');
  t.seq('out', out, 'flow', 'output so far');
  // The queue is the working storage; `out` is the answer being returned.
  // This is the measurement that shows BFS costs the width of the tree while
  // the recursive traversals cost its height.
  t.aux('queue', () => queue.length);

  // Depth of each node, so the oracle can state what "level order" means
  // without the traversal being asked to trust itself.
  const depth = new Map<string, number>();
  const walk = (id: string | null, d: number) => {
    if (!id) return;
    depth.set(id, d);
    walk(nodes.get(id)!.left, d + 1);
    walk(nodes.get(id)!.right, d + 1);
  };
  walk(root, 0);
  t.oracle({ total: nodes.size });

  // Taking from the back turns the queue into a stack, and level order into
  // something depth-first. Same code shape, entirely different traversal.
  const fromBack = mut.has('take-from-back');
  const skipRight = mut.has('skip-right');

  const ids: string[] = [];
  t.enter('levelOrder', 'levelOrder(root)');

  t.step(2, { queued: 0, done: 0, level: null }, 'The output starts empty.');
  t.step(3, { queued: 0, done: 0, level: null }, 'So does the queue. It holds the nodes that are known about but not yet processed.');

  t.step(
    5,
    { queued: 0, done: 0, level: null },
    root === null ? 'The tree is empty, so nothing is ever queued.' : 'The tree has a root, so it goes in first.',
    ev.cmp({ kind: 'literal', value: root === null ? 'null' : 'root' }, '!=', { kind: 'literal', value: 'null' }, root !== null),
  );

  if (root !== null) {
    ids.push(root);
    queue.push(nodes.get(root)!.value);
    state[root] = CELL_STATE.frontier;
    t.step(6, { queued: queue.length, done: 0, level: 0 }, `Queue the root, ${nodes.get(root)!.value}.`, ev.push('queue', nodes.get(root)!.value));
  }

  // The claim this traversal makes: everything already emitted sits at a depth
  // no greater than anything still waiting.
  const recheck = () => {
    const emittedMax = Math.max(-1, ...ids.slice(0, out.length).map((id) => depth.get(id) ?? 0));
    const queuedMin = queue.length === 0 ? Infinity : Math.min(...ids.slice(out.length).map((id) => depth.get(id) ?? 0));
    t.derive({ byLevel: emittedMax <= queuedMin ? 1 : 0 });
  };

  let guard = 0;
  while (queue.length > 0 && guard++ < 100_000) {
    t.step(8, { queued: queue.length, done: out.length, level: null }, `${queue.length} node${queue.length === 1 ? '' : 's'} waiting. Keep going.`, ev.cmp({ kind: 'var', name: 'queued' }, '>', { kind: 'literal', value: 0 }, true));

    const pos = fromBack ? ids.length - 1 : out.length;
    const id = fromBack ? ids.splice(pos, 1)[0] : ids[out.length];
    const value = fromBack ? (queue.splice(queue.length - 1, 1)[0] as number) : (queue.shift() as number);
    if (fromBack) ids.splice(out.length, 0, id);

    const node = nodes.get(id)!;
    t.step(9, { queued: queue.length + 1, done: out.length, level: depth.get(id) ?? 0 }, `Take ${node.value} off the ${fromBack ? 'back' : 'front'} of the queue.`, ev.readNode('tree', id));
    t.step(10, { queued: queue.length, done: out.length, level: depth.get(id) ?? 0 }, `Remove it — it is about to be dealt with, so it must not be dealt with twice.`, ev.pop('queue', value));

    state[id] = CELL_STATE.visited;
    out.push(node.value);
    recheck();
    t.step(12, { queued: queue.length, done: out.length, level: depth.get(id) ?? 0 }, `Record ${node.value}. It is at depth ${depth.get(id) ?? 0}.`, ev.visit('tree', id));

    for (const [line, side] of [
      [14, 'left'],
      [17, 'right'],
    ] as const) {
      if (side === 'right' && skipRight) continue;
      const child = node[side];
      t.step(
        line,
        { queued: queue.length, done: out.length, level: depth.get(id) ?? 0 },
        child === null ? `${node.value} has no ${side} child.` : `${node.value} has a ${side} child, ${nodes.get(child)!.value}.`,
        ev.cmp({ kind: 'literal', value: child === null ? 'null' : 'child' }, '!=', { kind: 'literal', value: 'null' }, child !== null),
      );
      if (child === null) continue;
      ids.push(child);
      queue.push(nodes.get(child)!.value);
      state[child] = CELL_STATE.frontier;
      recheck();
      t.step(line + 1, { queued: queue.length, done: out.length, level: depth.get(id) ?? 0 }, `Queue ${nodes.get(child)!.value} behind everything already waiting.`, ev.push('queue', nodes.get(child)!.value));
    }
  }

  t.step(8, { queued: 0, done: out.length, level: null }, 'The queue is empty, so every reachable node has been dealt with.', ev.cmp({ kind: 'var', name: 'queued' }, '>', { kind: 'literal', value: 0 }, false));
  t.exit();

  const answer = out.join(',');
  t.derive({
    complete: out.length === nodes.size && new Set(out.map(String)).size === out.length ? 1 : 0,
  });
  t.step(21, { queued: 0, done: out.length, level: null }, `Level order: ${answer || 'nothing'}.`);
  return answer;
};

export const levelOrder: AlgorithmDef = {
  slug: 'level-order',
  name: 'Level-order Traversal (BFS)',
  category: 'trees',
  tagline: 'Visit a tree one whole level at a time, using a queue.',
  intuition: [
    'Every other traversal on this site is recursive. This one cannot be: recursion goes deep first, and level order needs to go wide. The queue is what replaces the call stack, and swapping one for the other is the entire difference between breadth-first and depth-first search.',
    'The rule is small. Take a node off the front, record it, and put its children on the back. Because children always go behind everything already waiting, a node at depth 3 can never be taken before a node at depth 2 — the queue enforces the level order rather than the code checking for it.',
    'Watch the queue rather than the tree. Its length is the width of the frontier, and it is what makes BFS expensive in memory: at the widest level of a balanced tree the queue holds about half the nodes.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'tree',
    pointers: [],
    regions: [],
    invariant: {
      text: 'Nothing already recorded is deeper than anything still in the queue.',
      check: 'byLevel === 1',
      when: 'defined(byLevel)',
      why: 'This is what "level order" means, stated so it can be checked. It is a consequence of the queue being first-in-first-out and children always being added to the back — not of any code that looks at depth. Take from the back instead and the property fails immediately, without a single line looking obviously wrong.',
    },
    postcondition: {
      text: 'Every node in the tree appears in the output, exactly once.',
      check: 'complete === 1',
      why: 'The invariant is about order: nothing emitted is deeper than anything still waiting. A traversal that never discovers right children keeps that promise perfectly while returning a fraction of the tree. Order and completeness are separate claims and both are needed.',
    },
  },
  run,
  defaultInput: { array: [8, 3, 10, 1, 6, 14, 4, 7, 13] },
  fields: [
    {
      key: 'array',
      label: 'Insert these values, in this order',
      kind: 'array',
      help: 'The tree is built by BST insertion. A sorted list gives a chain, which makes BFS and DFS agree.',
    },
  ],
  makeInput: (n) => ({ array: balancedOrder(n) }),
  growthSizes: [64, 128, 256, 512, 1024, 2048, 4096],
  projectTo: 1_000_000,
  complexity: {
    time: 'O(n)',
    space: 'O(w), the widest level — O(n) in the worst case, and on the balanced trees measured here',
    note: 'Each node is queued once and dequeued once. Space is the width of the tree rather than its height — the opposite of the recursive traversals, and the reason BFS can run out of memory on a wide tree where DFS would not.',
  },
  userLane: {
    fnName: 'levelOrder',
    compareBy: 'return',
    binds: 'tree',
    starters: {
      cpp: `struct Node {
    int val;
    Node* left;
    Node* right;
};

vector<int> levelOrder(Node* root) {
    vector<int> out;
    queue<Node*> q;

    if (root != nullptr)
        q.push(root);

    while (!q.empty()) {
        Node* node = q.front();
        q.pop();

        out.push_back(node->val);

        if (node->left != nullptr)
            q.push(node->left);

        if (node->right != nullptr)
            q.push(node->right);
    }

    return out;
}`,
      c: `struct Node {
    int val;
    struct Node* left;
    struct Node* right;
};

int countNodes(struct Node* node) {
    if (node == NULL)
        return 0;

    return 1 + countNodes(node->left) + countNodes(node->right);
}

int* levelOrder(struct Node* root) {
    int n = countNodes(root);
    int out[n];
    struct Node* q[n + 1];
    int head = 0, tail = 0, k = 0;

    if (root != NULL) {
        q[tail] = root;
        tail = tail + 1;
    }

    while (head < tail) {
        struct Node* node = q[head];
        head = head + 1;

        out[k] = node->val;
        k = k + 1;

        if (node->left != NULL) {
            q[tail] = node->left;
            tail = tail + 1;
        }

        if (node->right != NULL) {
            q[tail] = node->right;
            tail = tail + 1;
        }
    }

    return out;
}`,
      java: `class Node {
    int val;
    Node left;
    Node right;
}

List<Integer> levelOrder(Node root) {
    List<Integer> out = new ArrayList<>();
    Deque<Node> q = new ArrayDeque<>();

    if (root != null)
        q.addLast(root);

    while (!q.isEmpty()) {
        Node node = q.peekFirst();
        q.pollFirst();

        out.add(node.val);

        if (node.left != null) q.addLast(node.left);
        if (node.right != null) q.addLast(node.right);
    }

    return out;
}`,
      js: `function levelOrder(root) {
  let out = [];
  let q = [];

  if (root !== null) q.push(root);

  while (q.length > 0) {
    let node = q.shift();

    out.push(node.val);

    if (node.left !== null) q.push(node.left);
    if (node.right !== null) q.push(node.right);
  }

  return out;
}`,
    },
  },
  mutations: [
    {
      id: 'take-from-back',
      edits: [
        { line: 9, from: 'Node* node = q.front();', to: 'Node* node = q.back();', langs: ['cpp'] },
        { line: 10, from: 'q.pop();', to: 'q.pop_back();', langs: ['cpp'] },
        { line: 9, from: 'struct Node* node = q[head];', to: 'struct Node* node = q[tail - 1];', langs: ['c'] },
        { line: 10, from: 'head++;', to: 'tail--;', langs: ['c'] },
        { line: 9, from: 'Node node = q.peekFirst();', to: 'Node node = q.peekLast();', langs: ['java'] },
        { line: 10, from: 'q.pollFirst();', to: 'q.pollLast();', langs: ['java'] },
      ],
      label: 'take from the back',
      note: 'Turns the queue into a stack, and breadth-first into depth-first.',
    },
    {
      id: 'skip-right',
      edits: [
        { line: 17, from: 'if (node->right != nullptr)', to: 'if (false)', langs: ['cpp'] },
        { line: 17, from: 'if (node->right != NULL)', to: 'if (0)', langs: ['c'] },
        { line: 17, from: 'if (node.right != null)', to: 'if (false)', langs: ['java'] },
      ],
      label: 'never queue right children',
      note: 'Only left children are ever discovered, so most of the tree is unreachable.',
    },
  ],
  variants: [
    {
      id: 'take-from-back',
      label: 'Takes from the back of the queue',
      blurb: 'Every node still comes out, in a completely different order.',
      explanation:
        'A queue and a stack differ by exactly one thing: which end you take from. Take from the back and each node is followed immediately by its most recently queued child, which is depth-first order. Nothing crashes, nothing is lost, and the count is identical — so a test that only checks "did we see every node" passes. The invariant is what catches it: a node from a deeper level gets emitted while shallower nodes are still waiting.',
      mutations: ['take-from-back'],
    },
    {
      id: 'skip-right',
      label: 'Only ever queues left children',
      blurb: 'Comes back quickly with a fraction of the tree.',
      explanation:
        'Right children are never discovered, so the traversal only reaches the left spine. Every node it does emit is in correct level order — the invariant holds throughout — which is the useful lesson here: an invariant rules out one specific kind of wrongness, not all of them. Compare the output length against the node count to see it.',
      mutations: ['skip-right'],
    },
  ],
  edgeCases: [
    { id: 'balanced', label: 'Balanced', input: { array: [8, 3, 10, 1, 6, 14, 4, 7, 13] }, why: 'The queue grows to about half the width of the tree at its widest level.' },
    { id: 'sorted', label: 'Sorted input', input: { array: [1, 2, 3, 4, 5] }, why: 'A chain: every level has one node, so the queue never holds more than one and BFS matches DFS exactly.' },
    { id: 'left-chain', label: 'Reverse sorted', input: { array: [5, 4, 3, 2, 1] }, why: 'A chain the other way. The "never queue right children" bug is invisible here.' },
    { id: 'wide', label: 'Wide and shallow', input: { array: [50, 25, 75, 12, 37, 62, 87] }, why: 'A full tree: the last level alone is four of the seven nodes, all in the queue at once.' },
    { id: 'single', label: 'One node', input: { array: [7] }, why: 'One push, one pop, and the queue is empty again.' },
    { id: 'empty', label: 'Empty tree', input: { array: [] }, why: 'The root is null, so nothing is ever queued and the loop never runs.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 12, nth: 2 },
      question: 'Children are always added to the back of the queue. What does that enforce?',
      options: [
        'A node at depth d + 1 can never be taken before one at depth d',
        'That the tree is balanced',
        'That children come out in sorted order',
        'That the queue never grows',
      ],
      answer: 'A node at depth d + 1 can never be taken before one at depth d',
      because:
        'Nothing in this function looks at a depth. The level ordering comes entirely from the container: anything discovered later joins the back, so it cannot overtake what is already waiting. Swap the queue for a stack and the code is unchanged in every other respect and no longer does level order at all.',
    }),
    computed({
      where: { line: 12, nth: 1 },
      question: (step) => `The root has been recorded and ${step.vars.queued} node${Number(step.vars.queued) === 1 ? ' is' : 's are'} waiting. What limits how large this queue can get?`,
      answer: () => 'The widest level of the tree',
      options: (a) => [
        a,
        'The height of the tree',
        'The number of nodes',
        'It never holds more than two',
      ],
      because:
        'The queue holds one level while the next is being discovered, so its peak is the width of the tree. That is the mirror image of the recursive traversals, which cost the height instead. A wide shallow tree is cheap for depth-first search and expensive here; a long chain is the reverse.',
    }),
    conceptual({
      where: { line: 10, nth: 1 },
      question: 'Why is the node removed from the queue before its children are added?',
      options: [
        'So that it cannot be processed twice',
        'To keep the queue small',
        'Because its children replace it',
        'It makes no difference',
      ],
      answer: 'So that it cannot be processed twice',
      because:
        'On a tree it would not actually matter, because nothing points back and a node can only be reached once. On a graph it matters completely, and this is the same loop — which is why breadth-first search on a graph needs a visited set in exactly the place a tree does not.',
    }),
    {
      locate: (trace) => trace.steps.findIndex((s) => s.line === 12 && Number(s.vars.done) === 1),
      question: () =>
        'The root has just been recorded and both of its children are about to be queued. What will come out next?',
      options: () => [
        'The left child of the root',
        'The right child of the root',
        'The deepest node on the left',
        'Whichever child is smaller',
      ],
      answer: () => 'The left child of the root',
      because: () =>
        'The left child is pushed first, so it sits ahead of the right child in the queue, and the queue is taken from the front. Note what this is not: there is no comparison of the two children and no depth check anywhere in the code. The order comes entirely from the shape of the container.',
    },
  ],
};
