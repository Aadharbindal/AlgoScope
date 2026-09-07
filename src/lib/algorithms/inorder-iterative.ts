import { ev, lit, vr } from '../trace/tracer';
import { CELL_STATE, Scalar } from '../trace/types';
import { balancedOrder, buildBst } from './tree';
import { computed, conceptual } from './checkpoints';
import { AlgorithmDef, RunFn } from './types';

/**
 * The same in-order walk, with the stack written out by hand.
 *
 * The recursive version's stack is the call stack; this one keeps its own. The
 * output is identical, the number of nodes entered is identical, and the whole
 * point of having both is that the second makes visible what the first hides:
 * there was always a stack, and it was always as deep as the tree.
 */

const CPP = `vector<int> inorder(Node* root) {
    vector<int> out;
    stack<Node*> st;
    Node* node = root;

    while (node != nullptr || !st.empty()) {
        while (node != nullptr) {
            st.push(node);
            node = node->left;
        }

        node = st.top();
        st.pop();

        out.push_back(node->val);

        node = node->right;
    }

    return out;
}`;

const C = `void inorder(struct Node* root, int out[], int* k) {
    struct Node* st[64];
    int top = 0;
    struct Node* node = root;

    while (node != NULL || top > 0) {
        while (node != NULL) {
            st[top++] = node;
            node = node->left;
        }

        node = st[--top];


        out[(*k)++] = node->val;

        node = node->right;
    }

    return;
}`;

const JAVA = `List<Integer> inorder(Node root) {
    List<Integer> out = new ArrayList<>();
    Deque<Node> st = new ArrayDeque<>();
    Node node = root;

    while (node != null || !st.isEmpty()) {
        while (node != null) {
            st.addLast(node);
            node = node.left;
        }

        node = st.peekLast();
        st.pollLast();

        out.add(node.val);

        node = node.right;
    }

    return out;
}`;

interface Opts {
  /** The buggy version never descends left, so the stack does nothing. */
  descendLeft: boolean;
  /** The buggy version emits a node on the way down instead of on the way up. */
  emitOnPop: boolean;
}

function makeRun(opts: Opts): RunFn {
  return (input, t) => {
    const values = (input.array ?? []).slice();
    const { nodes, root, sorted } = buildBst(values);

    const out: Scalar[] = [];
    const stack: Scalar[] = [];
    const state: Record<string, number> = {};

    t.tree('tree', nodes, root, { state: () => state, label: 'tree' });
    t.seq('st', stack, 'stack', 'st — nodes waiting to be emitted');
    t.seq('out', out, 'flow', 'output so far');
    t.aux('st', () => stack.length);
    t.oracle({ answer: sorted.join(','), total: nodes.size });

    /** Nodes entered, and the deepest the hand-written stack ever got. */
    let entered = 0;
    let deepest = 0;

    const label = (id: string | null) => (id === null ? 'nullptr' : String(nodes.get(id)!.value));
    const mark = () => {
      if (!t.tracing) return;
      deepest = Math.max(deepest, stack.length);
      t.derive({
        held: stack.length,
        emitted: out.length,
        inOrder: isSorted(out) ? 1 : 0,
      });
    };

    const ids: string[] = [];
    let node: string | null = root;

    t.enter('inorder', 'inorder(root)');
    mark();
    t.step(4, { node: label(node), held: 0, emitted: 0 }, `Start at the root, ${label(node)}, with an empty stack.`, ev.call('inorder', 'inorder(root)'));

    let guard = 0;
    while ((node !== null || ids.length > 0) && guard++ < 100_000) {
      t.step(6, { node: label(node), held: stack.length, emitted: out.length }, node !== null ? `There is a node to descend into, so keep going.` : `No node in hand, but ${ids.length} still waiting on the stack.`, ev.cmp(vr('node'), '!=', lit(null), node !== null));

      // Push everything on the left spine. This is the descent the recursive
      // version does with calls, written out.
      while (node !== null) {
        const topOfDescent = node;
        entered++;
        ids.push(node);
        stack.push(nodes.get(node)!.value);
        state[node] = CELL_STATE.frontier;
        mark();
        t.step(8, { node: label(node), held: stack.length, emitted: out.length }, `Push ${label(node)} and go left — it cannot be emitted until everything smaller has been.`, ev.push('st', nodes.get(node)!.value));

        node = opts.descendLeft ? nodes.get(node)!.left : null;
        t.step(9, { node: label(node), held: stack.length, emitted: out.length }, opts.descendLeft ? `Left of there is ${label(node)}.` : 'Do not descend left at all — go straight back up.', ev.readNode('tree', topOfDescent));
        if (!opts.descendLeft) break;
      }

      const topId = ids.pop()!;
      stack.pop();
      node = topId;
      state[topId] = CELL_STATE.visited;
      mark();
      t.step(12, { node: label(node), held: stack.length, emitted: out.length }, `Take ${label(topId)} back off the stack. Everything to its left is done.`, ev.pop('st', nodes.get(topId)!.value));

      out.push(nodes.get(topId)!.value);
      mark();
      t.step(15, { node: label(node), held: stack.length, emitted: out.length }, `Emit ${label(topId)}.`, ev.readNode('tree', topId));

      node = opts.emitOnPop ? nodes.get(topId)!.right : null;
      t.step(17, { node: label(node), held: stack.length, emitted: out.length }, opts.emitOnPop ? `Now the right subtree of ${label(topId)}, starting at ${label(node)}.` : `Ignore the right subtree entirely.`, ev.readNode('tree', topId));
    }

    const answer = out.join(',');
    t.derive({
      held: 0,
      emitted: out.length,
      inOrder: isSorted(out) ? 1 : 0,
      complete: out.length === nodes.size && new Set(out.map(String)).size === out.length ? 1 : 0,
      entered,
      deepest,
      total: nodes.size,
    });
    t.step(20, { node: 'nullptr', held: 0, emitted: out.length }, `Traversal complete: ${answer || 'nothing'}.`);
    t.exit();
    return answer;
  };
}

const isSorted = (xs: Scalar[]) => {
  for (let i = 1; i < xs.length; i++) if (Number(xs[i - 1]) > Number(xs[i])) return false;
  return true;
};

/** The two authored bugs are the two options, read off the active mutations. */
const run: RunFn = (input, t, mut) =>
  makeRun({ descendLeft: !mut.has('no-left'), emitOnPop: !mut.has('no-right') })(input, t, mut);

export const inorderIterative: AlgorithmDef = {
  slug: 'inorder-iterative',
  name: 'In-order Traversal — iterative',
  category: 'trees',
  tagline: 'The same walk, with the stack written out instead of borrowed from the language.',
  intuition: [
    'The recursive walk has a stack — it is just the call stack, and you cannot see it. This version keeps its own, and everything else about the two is the same.',
    'The rule is unchanged: a node cannot be emitted until everything to its left has been. So push your way down the left spine, and when there is nothing further left, the node on top of the stack is the smallest thing not yet emitted.',
    'Emit it, then step right once — and repeat. Stepping right is what makes this a loop rather than a walk: the right subtree is a whole new problem of the same shape, and the stack still holds everything above it.',
    'Compare the stack drawn here with the call stack on the recursive page. They hold the same nodes at the same moments, because they are the same stack.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'tree',
    pointers: [],
    regions: [],
    invariant: {
      text: 'Everything emitted so far is in increasing order.',
      check: 'inOrder === 1',
      when: 'defined(inOrder)',
      why: 'The output is sorted not because anything compares values during the walk, but because the tree already did that work when the values were inserted — and because a node is held on the stack until its whole left subtree is out. Emit on the way down instead of on the way up and the output is still every node, in an order that is no longer sorted.',
    },
    postcondition: {
      text: 'Every node in the tree appears in the output, exactly once.',
      check: 'complete === 1',
      why: 'Sorted and complete are two different promises, and a walk that never descends into a right subtree keeps the first perfectly while returning a fraction of the tree. This is the one that notices half the nodes missing.',
    },
    cost: {
      text: 'Every node is pushed once and popped once, and the stack is never deeper than the tree is tall.',
      check: 'entered === total && deepest <= total',
      why: 'The recursive version pays a call frame per level and this one pays a stack entry per level, which is the same bill from a different account — and that is the reason for having both. Insert a sorted array to make the tree a chain and watch the stack reach the whole length of it; insert middle-out and watch it stay near log n. Neither changes a single value in the output.',
    },
  },
  run,
  defaultInput: { array: [8, 3, 10, 1, 6, 14, 4, 7, 13] },
  fields: [
    {
      key: 'array',
      label: 'Insert these values, in this order',
      kind: 'array',
      help: 'The tree is built by inserting left to right. A sorted list gives a chain, and the stack then holds every node at once.',
    },
  ],
  makeInput: (n) => ({ array: balancedOrder(n) }),
  growthSizes: [64, 128, 256, 512, 1024, 2048],
  projectTo: 1_000_000,
  complexity: {
    time: 'O(n)',
    space: 'O(h), the height of the tree — O(log n) balanced, O(n) for a chain',
    note: 'The same two figures as the recursive version, and that is the point: writing the stack out by hand does not make it cheaper, it makes it visible. What it does buy is a bound you control — this version cannot overflow the call stack, because it is not using it.',
  },
  mutations: [
    {
      id: 'no-left',
      edits: [
        { line: 9, from: 'node = node->left;', to: 'node = nullptr;', langs: ['cpp'] },
        { line: 9, from: 'node = node->left;', to: 'node = NULL;', langs: ['c'] },
        { line: 9, from: 'node = node.left;', to: 'node = null;', langs: ['java'] },
      ],
      label: 'never descend left',
      note: 'The inner loop pushes one node and stops, so the left subtree is never reached.',
    },
    {
      id: 'no-right',
      edits: [
        { line: 17, from: 'node = node->right;', to: 'node = nullptr;', langs: ['cpp'] },
        { line: 17, from: 'node = node->right;', to: 'node = NULL;', langs: ['c'] },
        { line: 17, from: 'node = node.right;', to: 'node = null;', langs: ['java'] },
      ],
      label: 'never step right',
      note: 'After emitting a node the walk goes straight back to the stack, so no right subtree is ever entered.',
    },
  ],
  variants: [
    {
      id: 'no-left',
      label: 'The left spine is never descended',
      blurb: 'The output is short, and what is there is in the wrong order.',
      explanation:
        'The inner loop is the entire descent — it pushes a node and moves left, over and over, until there is nothing further left. Stop it after one push and the stack is never more than a node deep, so nothing is held back and nodes come out in the order the loop happens to reach them.',
      mutations: ['no-left'],
    },
    {
      id: 'no-right',
      label: 'The right subtree is never entered',
      blurb: 'Everything that comes out is in order, and most of the tree is missing.',
      explanation:
        'Stepping right after emitting is what turns this from a walk down the left edge into a traversal of the whole tree. Without it every right subtree is skipped, and what remains is the left spine — which is genuinely sorted, satisfies the invariant at every step, and is a fraction of the answer.',
      mutations: ['no-right'],
    },
  ],
  edgeCases: [
    { id: 'balanced', label: 'Balanced', input: { array: [8, 3, 10, 1, 6, 14, 4, 7, 13] }, why: 'The stack stays about log n deep — the case the recursive version also handles comfortably.' },
    { id: 'sorted', label: 'Sorted input', input: { array: [1, 2, 3, 4, 5, 6] }, why: 'Every insert goes right, so the tree is a chain and the stack never holds more than one node. The mirror of the recursive version’s deepest case.' },
    { id: 'reverse', label: 'Reverse sorted', input: { array: [6, 5, 4, 3, 2, 1] }, why: 'A chain the other way: the whole tree goes onto the stack before anything comes out. This is the input where the hand-written stack is as tall as the tree.' },
    { id: 'single', label: 'One node', input: { array: [42] }, why: 'One push, one pop, one value.' },
    { id: 'dupes', label: 'Repeated values', input: { array: [5, 3, 5, 8, 3] }, why: 'A repeat is not inserted twice, so the tree holds fewer nodes than the input has values.' },
    { id: 'empty', label: 'Empty tree', input: { array: [] }, why: 'The loop condition is false immediately: no node in hand and nothing on the stack.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 8, nth: 2 },
      question: 'A node is pushed rather than emitted. What is being deferred, and until when?',
      options: [
        'Emitting it, until everything in its left subtree has been emitted',
        'Reading its value, until the tree is fully explored',
        'Nothing — the push is only bookkeeping',
        'Its right subtree, until the stack empties',
      ],
      answer: 'Emitting it, until everything in its left subtree has been emitted',
      because:
        'That single rule is what makes the output sorted, and it is the same rule the recursive version follows by making its left call before recording anything. The stack exists to remember the nodes you have walked past but are not finished with.',
    }),
    conceptual({
      where: { line: 17, nth: 1 },
      question: 'The walk steps right after emitting. Why does the stack not need to remember to come back here?',
      options: [
        'Because this node is finished — everything left of it and itself are out',
        'Because the right subtree is always empty',
        'Because the stack already holds this node twice',
        'It does need to, and this is the bug',
      ],
      answer: 'Because this node is finished — everything left of it and itself are out',
      because:
        'In-order means left, self, right. Once the first two are done there is nothing left to return to this node for, so it can leave the stack for good. What is still on the stack below it are the ancestors it has not finished being the left subtree of.',
    }),
    computed({
      where: { line: 12, nth: 3 },
      question: () => 'How many nodes are still waiting on the stack right after this pop?',
      answer: (step) => String(step.vars.held ?? 0),
      options: (answer) => {
        const h = Number(answer);
        return [String(h), String(h + 1), String(Math.max(0, h - 1)), '0'];
      },
      because:
        'Every node on the stack is an ancestor whose left subtree is still being finished. On a balanced tree that is about the height; on a chain built from a reverse-sorted insert it is the whole tree, which is the space the recursive version spends invisibly.',
    }),
  ],
};
