import { ev } from '../trace/tracer';
import { CELL_STATE, Scalar } from '../trace/types';
import { balancedOrder, buildBst } from './tree';
import { computed, conceptual } from './checkpoints';
import { AlgorithmDef, RunFn } from './types';

const CPP = `void inorder(Node* node, vector<int>& out) {
    if (node == nullptr)
        return;

    inorder(node->left, out);

    out.push_back(node->val);

    inorder(node->right, out);
}`;

const C = `void inorder(struct Node* node, int out[], int* k) {
    if (node == NULL)
        return;

    inorder(node->left, out, k);

    out[(*k)++] = node->val;

    inorder(node->right, out, k);
}`;

const JAVA = `void inorder(Node node, List<Integer> out) {
    if (node == null)
        return;

    inorder(node.left, out);

    out.add(node.val);

    inorder(node.right, out);
}`;

const run: RunFn = (input, t, mut) => {
  const values = (input.array ?? []).slice();
  const { nodes, root, sorted } = buildBst(values);

  const out: Scalar[] = [];
  const state: Record<string, number> = {};

  t.tree('tree', nodes, root, { state: () => state, label: 'tree' });
  t.seq('out', out, 'flow', 'output so far');
  t.oracle({ answer: sorted.join(','), total: nodes.size });

  // Visiting the node before recursing left is preorder, not inorder — the
  // single most common way this gets written from memory.
  const visitFirst = mut.has('preorder');
  const skipRight = mut.has('skip-right');

  t.enter('inorder', `inorder(${root ? 'root' : 'null'})`);

  /** Nodes entered. A traversal enters each node once — that is what it is. */
  let entered = 0;

  const visit = (id: string | null, depth: number) => {
    if (id !== null) entered++;
    t.step(
      2,
      { node: id, depth, seen: out.length },
      id === null
        ? 'This branch is empty, so there is nothing to walk. The recursion stops here.'
        : `At node ${nodes.get(id)!.value}. Not null, so this subtree has to be walked.`,
      ev.cmp(
        { kind: 'literal', value: id === null ? 'null' : 'node' },
        '==',
        { kind: 'literal', value: 'null' },
        id === null,
      ),
    );

    if (id === null) {
      t.step(3, { node: id, depth, seen: out.length }, 'Return to the caller.');
      return;
    }

    const node = nodes.get(id)!;
    state[id] = CELL_STATE.frontier;

    const emit = () => {
      state[id] = CELL_STATE.visited;
      out.push(node.value);
      t.step(
        7,
        { node: id, depth, seen: out.length },
        `Record ${node.value}. Everything smaller than it has already been recorded, so the output stays in order.`,
        ev.visit('tree', id),
      );
    };

    const goLeft = () => {
      t.enter('inorder', `inorder(${node.left ? nodes.get(node.left)!.value : 'null'})`);
      t.step(
        5,
        { node: id, depth, seen: out.length },
        `Walk the left subtree of ${node.value} first — every value in it is smaller.`,
        ev.call('inorder', 'inorder(left)'),
      );
      visit(node.left, depth + 1);
      t.exit();
    };

    if (visitFirst) {
      emit();
      goLeft();
    } else {
      goLeft();
      emit();
    }

    if (!skipRight) {
      t.enter('inorder', `inorder(${node.right ? nodes.get(node.right)!.value : 'null'})`);
      t.step(
        9,
        { node: id, depth, seen: out.length },
        `Now the right subtree of ${node.value} — every value in it is larger.`,
        ev.call('inorder', 'inorder(right)'),
      );
      visit(node.right, depth + 1);
      t.exit();
    }

    // The promise the traversal makes, checked at the moment it could break.
    t.derive({ inOrder: isSorted(out) ? 1 : 0 });
    t.step(
      10,
      { node: id, depth, seen: out.length },
      `Finished with ${node.value} and both of its subtrees.`,
      ev.ret('inorder', node.value),
    );
  };

  visit(root, 0);
  t.exit();

  const answer = out.join(',');
  // Sorted is not the same as complete, and a walk that skips every right
  // subtree is the first of those and not the second.
  t.derive({
    entered,
    complete: out.length === nodes.size && new Set(out.map(String)).size === out.length ? 1 : 0,
  });
  t.step(10, { node: null, depth: 0, seen: out.length }, `Traversal complete: ${answer || 'nothing'}.`);
  return answer;
};

/** Node values of the tree as it stood at a step, in insertion order. */
function nodeValues(trace: { steps: { structs: Record<string, { kind: string }> }[] }, at: number): number[] {
  const tree = trace.steps[at]?.structs.tree;
  return tree && tree.kind === 'tree'
    ? (tree as unknown as { nodes: { value: number }[] }).nodes.map((n) => n.value)
    : [];
}

const isSorted = (xs: Scalar[]) => {
  for (let i = 1; i < xs.length; i++) if (Number(xs[i - 1]) > Number(xs[i])) return false;
  return true;
};

export const inorderTraversal: AlgorithmDef = {
  slug: 'inorder-traversal',
  name: 'In-order Traversal',
  category: 'trees',
  tagline: 'Walk a binary search tree and get its values in sorted order.',
  intuition: [
    'Three lines of recursion, in a specific order: everything on the left, then this node, then everything on the right. Change the order of those three lines and you get a different traversal with a different name.',
    'On a binary search tree that order is not arbitrary. Every value in the left subtree is smaller than this node and every value on the right is larger, so walking left-node-right emits them in sorted order. The traversal is a sort that costs nothing extra, because the tree already did the work at insert time.',
    'Watch the call stack, not just the picture. The recursion descends to the leftmost node before recording anything at all — which is why the first value out is the smallest, and why a deep tree costs stack depth rather than time.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'tree',
    pointers: [],
    regions: [],
    invariant: {
      text: 'Everything recorded so far is in increasing order.',
      check: 'inOrder === 1',
      when: 'defined(inOrder)',
      why: 'This is the only thing in-order traversal claims, and it is what makes it useful for anything beyond printing. It holds because the walk cannot reach a node before finishing every node smaller than it. Visit the node before its left subtree and the claim fails on the very first node with a left child.',
    },
    postcondition: {
      text: 'Every node in the tree appears in the output, exactly once.',
      check: 'complete === 1',
      why: 'The invariant says the output is in increasing order, and a walk that skips every right subtree satisfies it completely — what it emits really is sorted. Sorted and complete are two different promises, and this is the one that notices half the tree missing.',
    },
    cost: {
      text: 'Every node is entered exactly once, so the walk costs the same whatever shape the tree is.',
      check: 'entered === n',
      why: 'The time an in-order walk takes does not depend on the shape of the tree — only its space does, and that is the pair of facts this algorithm exists to separate. A walk that revisited a subtree would still emit sorted values on many trees, and would have lost the only claim that makes traversal cost predictable. Insert a sorted array to watch the depth collapse into a chain while this number does not move.',
    },
  },
  run,
  defaultInput: { array: [8, 3, 10, 1, 6, 14, 4, 7, 13] },
  fields: [
    {
      key: 'array',
      label: 'Insert these values, in this order',
      kind: 'array',
      help: 'The tree is built by inserting left to right. A sorted list gives a chain, not a tree.',
    },
  ],
  makeInput: (n) => ({ array: balancedOrder(n) }),
  growthSizes: [64, 128, 256, 512, 1024, 2048, 4096],
  projectTo: 1_000_000,
  complexity: {
    time: 'O(n)',
    space: 'O(h), the height of the tree — O(log n) balanced, O(n) for a chain',
    note: 'Every node is entered exactly once, so time does not depend on the shape. Space does: the recursion holds one frame per level, which is log n for a balanced tree and n for a chain. Measured on balanced trees — insert a sorted array to see the chain instead.',
  },
  userLane: {
    fnName: 'inorder',
    compareBy: 'return',
    binds: 'tree',
    starters: {
      cpp: `struct Node {
    int val;
    Node* left;
    Node* right;
};

void walk(Node* node, vector<int>& out) {
    if (node == nullptr)
        return;

    walk(node->left, out);
    out.push_back(node->val);
    walk(node->right, out);
}

vector<int> inorder(Node* root) {
    vector<int> out;
    walk(root, out);
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

int fill(struct Node* node, int out[], int k) {
    if (node == NULL)
        return k;

    k = fill(node->left, out, k);
    out[k] = node->val;
    k = k + 1;
    return fill(node->right, out, k);
}

int* inorder(struct Node* root) {
    int out[countNodes(root)];
    fill(root, out, 0);
    return out;
}`,
      java: `class Node {
    int val;
    Node left;
    Node right;
}

void walk(Node node, List<Integer> out) {
    if (node == null)
        return;

    walk(node.left, out);
    out.add(node.val);
    walk(node.right, out);
}

List<Integer> inorder(Node root) {
    List<Integer> out = new ArrayList<>();
    walk(root, out);
    return out;
}`,
    },
  },
  mutations: [
    {
      id: 'preorder',
      edits: [
        { line: 5, from: 'inorder(node->left, out);', to: 'out.push_back(node->val);', langs: ['cpp'] },
        { line: 7, from: 'out.push_back(node->val);', to: 'inorder(node->left, out);', langs: ['cpp'] },
        { line: 5, from: 'inorder(node->left, out, k);', to: 'out[(*k)++] = node->val;', langs: ['c'] },
        { line: 7, from: 'out[(*k)++] = node->val;', to: 'inorder(node->left, out, k);', langs: ['c'] },
        { line: 5, from: 'inorder(node.left, out);', to: 'out.add(node.val);', langs: ['java'] },
        { line: 7, from: 'out.add(node.val);', to: 'inorder(node.left, out);', langs: ['java'] },
      ],
      label: 'record before descending',
      note: 'Moves the visit above the left call, which is preorder — a real traversal, just not this one.',
    },
    {
      id: 'skip-right',
      edits: [
        { line: 9, from: 'inorder(node->right, out);', to: '// inorder(node->right, out);', langs: ['cpp'] },
        { line: 9, from: 'inorder(node->right, out, k);', to: '// inorder(node->right, out, k);', langs: ['c'] },
        { line: 9, from: 'inorder(node.right, out);', to: '// inorder(node.right, out);', langs: ['java'] },
      ],
      label: 'never go right',
      note: 'Only the left spine of the tree is ever reached.',
    },
  ],
  variants: [
    {
      id: 'preorder',
      label: 'Records the node before its left subtree',
      blurb: 'Every value comes out, but not in the order you asked for.',
      explanation:
        'The three lines of an in-order walk are left, node, right. Putting the node first gives preorder — a perfectly good traversal that is used for copying a tree, and a completely wrong one for reading it in sorted order. Nothing crashes and nothing is lost, which is what makes this so easy to ship: the output is a permutation of the right answer.',
      mutations: ['preorder'],
    },
    {
      id: 'skip-right',
      label: 'Never walks the right subtree',
      blurb: 'Returns sorted output, and silently drops most of the tree.',
      explanation:
        'Without the second recursive call the walk only ever goes left, so it emits the left spine and stops. Notice that the invariant still holds — the output really is in increasing order — which is the point: an invariant tells you the answer is not wrong in that particular way, not that it is complete. Compare the count against the number of nodes to see what is missing.',
      mutations: ['skip-right'],
    },
  ],
  edgeCases: [
    { id: 'balanced', label: 'Balanced', input: { array: [8, 3, 10, 1, 6, 14, 4, 7, 13] }, why: 'Depth is about log n; the stack stays shallow.' },
    { id: 'sorted', label: 'Sorted input', input: { array: [1, 2, 3, 4, 5, 6] }, why: 'Every insert goes right, so the "tree" is a chain and the recursion is n deep. Same output, entirely different cost.' },
    { id: 'reverse', label: 'Reverse sorted', input: { array: [6, 5, 4, 3, 2, 1] }, why: 'A chain the other way. The walk descends to the bottom before emitting anything.' },
    { id: 'single', label: 'One node', input: { array: [42] }, why: 'Both subtrees are null, so both recursive calls hit the base case immediately.' },
    { id: 'dupes', label: 'Repeated values', input: { array: [5, 3, 5, 8, 3] }, why: 'A repeat is not inserted twice — a BST needs a rule for which side duplicates go on, and this one has no such rule.' },
    { id: 'empty', label: 'Empty tree', input: { array: [] }, why: 'The root is null, so the very first call returns without doing anything.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 5, nth: 1 },
      question: 'The recursion descends left before recording anything. What does that guarantee about the output?',
      options: [
        'Nothing is recorded until everything smaller has been',
        'The tree is balanced',
        'The root comes out first',
        'Each node is visited twice',
      ],
      answer: 'Nothing is recorded until everything smaller has been',
      because:
        'A node cannot be reached until its whole left subtree is done, and in a search tree that subtree holds exactly the values smaller than it. That is why the output is sorted — not because anything compares values during the walk, but because the tree already did that work when the values were inserted.',
    }),
    conceptual({
      where: { line: 2, nth: 2 },
      question: 'What is the base case actually testing for?',
      options: [
        'An absent child, which is where a branch ends',
        'A leaf node',
        'The end of the array',
        'That the tree is empty',
      ],
      answer: 'An absent child, which is where a branch ends',
      because:
        'It fires on every missing child, not just at the outer edge of the tree — a leaf makes two such calls. That is why a tree of n nodes makes about 2n calls in total, and why the null check is by far the most executed line in the function.',
    }),
    computed({
      where: { line: 9, nth: 1 },
      question: () => 'The left subtree is finished and this node has been recorded. What is true of everything still to come?',
      answer: () => 'It is all larger than this node',
      options: (a) => [
        a,
        'It is all smaller than this node',
        'It is unrelated to this node',
        'It is the rest of the left subtree',
      ],
      because:
        'Everything remaining is in the right subtree, and in a search tree that means everything remaining is larger. The output is therefore still sorted after this node, and will stay sorted for the same reason at every node below — which is exactly the invariant this page checks at every step.',
    }),
    {
      locate: (trace) => trace.steps.findIndex((s) => s.line === 7),
      question: (trace, at) =>
        `The recursion has just reached the first node it will record, out of ${nodeValues(trace, at).length}. Which value is it?`,
      options: (trace, at) => {
        const values = nodeValues(trace, at);
        const sorted = [...values].sort((a, b) => a - b);
        // The plausible wrong answers are the ones a reader actually reaches
        // for: the root, the largest, the second smallest.
        return [...new Set([sorted[0], values[0], sorted[sorted.length - 1], sorted[1]])]
          .filter((v) => v !== undefined)
          .map(String);
      },
      answer: (trace, at) => String(Math.min(...nodeValues(trace, at))),
      because: () =>
        'In-order never records a node until its entire left subtree is done, so the walk descends left as far as it can go before emitting anything. The first value out is therefore the leftmost node, which in a BST is the smallest — not the root, and not the first value you typed.',
    },
  ],
};
