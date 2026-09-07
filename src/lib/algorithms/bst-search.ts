import { cell, ev, vr } from '../trace/tracer';
import { CELL_STATE } from '../trace/types';
import { balancedOrder, buildBst } from './tree';
import { computed, conceptual } from './checkpoints';
import { AlgorithmDef, RunFn } from './types';

/**
 * Binary search, on a structure that has to be built rather than assumed.
 *
 * The comparison worth drawing is with binary search on a sorted array: the
 * decision at each step is identical — go left or go right — and the cost is
 * the same log n, *if* the tree is balanced. The difference is that an array
 * cannot be balanced badly, and a tree can. Insert a sorted sequence and this
 * becomes linear search with extra steps, which is a failure mode the array
 * version does not have and cannot have.
 */

const CPP = `bool contains(Node* root, int target) {
    Node* node = root;

    while (node != nullptr) {
        if (node->val == target)
            return true;

        if (target < node->val)
            node = node->left;
        else
            node = node->right;
    }

    return false;
}`;

const C = `int contains(struct Node* root, int target) {
    struct Node* node = root;

    while (node != NULL) {
        if (node->val == target)
            return 1;

        if (target < node->val)
            node = node->left;
        else
            node = node->right;
    }

    return 0;
}`;

const JAVA = `boolean contains(Node root, int target) {
    Node node = root;

    while (node != null) {
        if (node.val == target)
            return true;

        if (target < node.val)
            node = node.left;
        else
            node = node.right;
    }

    return false;
}`;

interface Opts {
  /** The buggy version goes right when it should go left. */
  leftWhenSmaller: boolean;
  /** The buggy version stops at the first leaf rather than following the links. */
  followLinks: boolean;
}

function makeRun(opts: Opts): RunFn {
  return (input, t) => {
    const values = (input.array ?? []).slice();
    const target = Number(input.target ?? 0);
    const { nodes, root } = buildBst(values);

    const state: Record<string, number> = {};
    let node: string | null = root;

    /** Nodes examined, against the height of the tree that was built. */
    let looked = 0;
    const treeHeight = (() => {
      const depth = (id: string | null): number =>
        id === null ? 0 : 1 + Math.max(depth(nodes.get(id)!.left), depth(nodes.get(id)!.right));
      return depth(root);
    })();

    t.tree('tree', nodes, root, { state: () => state, label: 'tree' });
    t.oracle({ present: values.includes(target) ? 1 : 0 });

    const label = (id: string | null) => (id === null ? 'nullptr' : String(nodes.get(id)!.value));

    /**
     * Everything ruled out so far really could not have held the target.
     *
     * Walked from the root along the path actually taken: at each turn the
     * subtree not entered is checked for the target. That is the claim the
     * whole descent rests on — one comparison discards an entire side — and it
     * is the claim a reversed comparison breaks while still finding plenty of
     * values by luck.
     */
    const mark = (path: string[]) => {
      if (!t.tracing) return;
      let sound = 1;
      let at: string | null = root;
      for (const stepId of path) {
        if (at === null) break;
        const here = nodes.get(at)!;
        const wentLeft = here.left === stepId;
        const skipped = wentLeft ? here.right : here.left;
        if (holds(skipped, target)) sound = 0;
        at = stepId;
      }
      t.derive({ discarded: sound, looked, height: treeHeight });
    };

    const holds = (id: string | null, want: number): boolean => {
      if (id === null) return false;
      const here = nodes.get(id)!;
      return here.value === want || holds(here.left, want) || holds(here.right, want);
    };

    const path: string[] = [];

    t.enter('contains', `contains(root, ${target})`);
    mark(path);
    t.step(2, { target, node: label(node), depth: 0 }, `Looking for ${target} in a tree of ${nodes.size} node${nodes.size === 1 ? '' : 's'}.`, ev.call('contains', `contains(root, ${target})`));

    let guard = 0;
    while (node !== null && guard++ < 100_000) {
      looked++;
      state[node] = CELL_STATE.path;
      mark(path);
      t.step(4, { target, node: label(node), depth: path.length }, `At ${label(node)}.`, ev.visit('tree', node));
      t.tick();

      const here = nodes.get(node)!;
      const hit = here.value === target;
      t.step(5, { target, node: label(node), depth: path.length }, hit ? `${here.value} is the target.` : `${here.value} is not ${target}.`, ev.cmp(cell('tree', 0), '==', vr('target'), hit));

      if (hit) {
        t.derive({ discarded: 1, looked, height: treeHeight, found: values.includes(target) ? 1 : 0, allowed: treeHeight });
        t.step(6, { target, node: label(node), depth: path.length }, `Found it.`, ev.found('tree', 0));
        t.exit();
        return 'true';
      }

      const smaller = target < here.value;
      t.step(8, { target, node: label(node), depth: path.length }, smaller ? `${target} is smaller than ${here.value}, so it can only be to the left.` : `${target} is larger than ${here.value}, so it can only be to the right.`, ev.cmp(vr('target'), '<', cell('tree', 0), smaller));

      const goLeft = opts.leftWhenSmaller ? smaller : !smaller;
      const next = opts.followLinks ? (goLeft ? here.left : here.right) : null;

      state[node] = CELL_STATE.visited;
      if (next !== null) path.push(next);
      node = next;
      mark(path);
      t.step(goLeft ? 9 : 11, { target, node: label(node), depth: path.length }, next === null ? `There is nothing that way, so ${target} is not in the tree.` : `Move to ${label(next)}.`);
    }

    t.derive({ discarded: 1, looked, height: treeHeight, found: values.includes(target) ? 0 : 1, allowed: treeHeight });
    t.step(14, { target, node: 'nullptr', depth: path.length }, `The walk ran off the bottom of the tree. ${target} is not here.`, ev.fail('fell off the tree'));
    t.exit();
    return 'false';
  };
}

const run: RunFn = (input, t, mut) =>
  makeRun({ leftWhenSmaller: !mut.has('flip'), followLinks: !mut.has('stop-early') })(input, t, mut);

export const bstSearch: AlgorithmDef = {
  slug: 'bst-search',
  name: 'Search a Binary Search Tree',
  category: 'trees',
  tagline: 'One comparison per node, and each one throws away a whole subtree.',
  intuition: [
    'A search tree keeps a promise about every node: everything to its left is smaller, everything to its right is larger. So one comparison at a node tells you which side the target must be on — and the other side can be discarded entirely, without looking at any of it.',
    'That is exactly the decision binary search makes on a sorted array. The difference is where the structure comes from: an array is halved by arithmetic and cannot be halved badly, while a tree is shaped by the order things were inserted into it.',
    'Insert 1, 2, 3, 4, 5 in that order and every value goes right of the last, so the "tree" is a chain and the search walks it one node at a time. Same code, same promise, linear cost. Type a sorted list into the box and watch it happen.',
    'This is why balanced trees exist, and why the cost of a search tree is quoted as O(h) rather than O(log n) — the two are only the same when someone has taken care to keep them so.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'tree',
    pointers: [],
    regions: [],
    invariant: {
      text: 'Every subtree skipped so far really could not have contained the target.',
      check: 'discarded === 1',
      when: 'defined(discarded)',
      why: 'The whole search rests on one comparison being enough to discard an entire side, and this is that claim written down. Reverse the comparison and the walk still visits nodes, still ends, and still returns a verdict — while having discarded the side the target was actually on. It finds plenty of values by luck, which is exactly what makes it worth checking directly rather than trusting the answer.',
    },
    postcondition: {
      text: 'The verdict matches whether the value was ever inserted.',
      check: 'found === 1',
      why: 'Checked against the list of values that went in, which is a fact the tree does not have to be consulted about. A search that got lost in the tree can still return a confident false, and that is the case this notices and the invariant alone might not.',
    },
    cost: {
      text: 'One node examined per level: the walk never looks at more nodes than the tree is tall.',
      check: 'looked <= allowed',
      why: 'This is the only reason to build a search tree rather than a list, and it is a claim about the *shape* of the tree as much as about the code. A sorted insertion order builds a chain, the height becomes the node count, and this bound — while still true — stops being worth anything. That is the honest way to state the cost of a search tree, and it is why the measurement on this page uses a balanced insertion order and says so.',
    },
  },
  run,
  defaultInput: { array: [8, 3, 10, 1, 6, 14, 4, 7, 13], target: 6 },
  fields: [
    {
      key: 'array',
      label: 'Insert these values, in this order',
      kind: 'array',
      help: 'Insertion order is the shape of the tree. A sorted list builds a chain, and the search becomes linear.',
    },
    { key: 'target', label: 'Look for', kind: 'number' },
  ],
  // `balancedOrder` emits the middle value first, so it becomes the root —
  // searching for it would measure a descent of one node however large the
  // tree is. The smallest value is the one at the far end of the left spine.
  makeInput: (n) => ({ array: balancedOrder(n), target: 1 }),
  growthSizes: [64, 128, 256, 512, 1024, 2048],
  projectTo: 1_000_000,
  complexity: {
    time: 'O(h), the height of the tree — O(log n) balanced, O(n) for a chain',
    space: 'O(1)',
    note: 'Quoted as the height rather than as log n, and that is not pedantry: the two are equal only when something keeps the tree balanced, and nothing here does. The measurement uses a balanced insertion order, so what it recovers is the good case. Type a sorted array into the box to see the other one — same code, same promise, and every node visited.',
  },
  mutations: [
    {
      id: 'flip',
      edits: [
        { line: 8, from: 'if (target < node->val)', to: 'if (target > node->val)', langs: ['cpp', 'c'] },
        { line: 8, from: 'if (target < node.val)', to: 'if (target > node.val)', langs: ['java'] },
      ],
      label: 'compare the wrong way round',
      note: 'Goes left for larger values and right for smaller ones.',
    },
    {
      id: 'stop-early',
      edits: [
        { line: 9, from: '            node = node->left;', to: '            node = nullptr;', langs: ['cpp'] },
        { line: 9, from: '            node = node->left;', to: '            node = NULL;', langs: ['c'] },
        { line: 9, from: '            node = node.left;', to: '            node = null;', langs: ['java'] },
      ],
      label: 'never descend left',
      note: 'Gives up as soon as the target is smaller than the node it is standing on.',
    },
  ],
  variants: [
    {
      id: 'flip',
      label: 'The comparison is reversed',
      blurb: 'It finds some values and confidently misses others.',
      explanation:
        'Going right for a smaller value discards the side the target is actually on. The walk still terminates, still visits a plausible number of nodes, and still returns a verdict — and it will find any value that happens to lie along the path it wrongly takes. The invariant catches it at the first turn, which is a long way before the answer does.',
      mutations: ['flip'],
    },
    {
      id: 'stop-early',
      label: 'The left branch is never taken',
      blurb: 'Everything smaller than the root is reported missing.',
      explanation:
        'Half of every decision is thrown away. Values on the right spine are still found, so it does not look obviously broken, and everything the search would have reached by going left is reported absent. The postcondition is the claim that notices, because the walk itself never does anything invalid — it just stops.',
      mutations: ['stop-early'],
    },
  ],
  edgeCases: [
    { id: 'present', label: 'Value is present', input: { array: [8, 3, 10, 1, 6, 14, 4, 7, 13], target: 6 }, why: 'Two turns and a hit, on a balanced tree.' },
    { id: 'absent', label: 'Value is absent', input: { array: [8, 3, 10, 1, 6, 14, 4, 7, 13], target: 5 }, why: 'The walk runs off the bottom. Absence is proved by arriving at nothing, not by looking everywhere.' },
    { id: 'root', label: 'It is the root', input: { array: [8, 3, 10], target: 8 }, why: 'One comparison, no descent.' },
    { id: 'chain', label: 'Sorted insertion', input: { array: [1, 2, 3, 4, 5, 6], target: 6 }, why: 'The tree is a chain, so the search visits every node. Same code, same invariant, and none of the benefit.' },
    { id: 'reverse-chain', label: 'Reverse sorted', input: { array: [6, 5, 4, 3, 2, 1], target: 1 }, why: 'A chain the other way. The worst case is not about the target — it is about the insertion order.' },
    { id: 'single', label: 'One node', input: { array: [42], target: 42 }, why: 'The smallest tree there is.' },
    { id: 'empty', label: 'Empty tree', input: { array: [], target: 1 }, why: 'The root is null, so the loop never runs and the answer is immediate.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 8, nth: 0 },
      question: 'One comparison decides which way to go. What does it let the search stop doing?',
      options: [
        'Looking at the entire other subtree',
        'Comparing values further down',
        'Reading the current node again',
        'Nothing — both sides are still searched',
      ],
      answer: 'Looking at the entire other subtree',
      because:
        'A search tree promises that everything left of a node is smaller and everything right is larger. So a single comparison rules out a whole side — which is the same move binary search makes when it discards half a range, and the reason both cost the logarithm rather than the size.',
    }),
    conceptual({
      where: { line: 8, nth: 1 },
      question: 'Everything not on the path walked so far has been discarded. What makes that a proof rather than a guess?',
      options: [
        'Each turn ruled out a side that could not hold the target, by the tree’s own promise',
        'The discarded nodes were all checked first',
        'The tree is balanced',
        'It is a guess — the value could still be elsewhere',
      ],
      answer: 'Each turn ruled out a side that could not hold the target, by the tree’s own promise',
      because:
        'This is why running off the bottom of the tree counts as a complete answer. Every subtree stepped past was ruled out by a comparison, so the only place the target could have been is the path just walked — and most of the tree was never looked at, which is the entire point.',
    }),
    computed({
      where: { line: 4, nth: 2 },
      question: () => 'How many nodes has the search looked at so far?',
      answer: (step) => String(Number(step.vars.depth) + 1),
      options: (answer) => {
        const d = Number(answer);
        return [String(d), String(d + 1), String(Math.max(1, d - 1)), '1'];
      },
      because:
        'One node per level, and the levels are the only thing the cost depends on. On a balanced tree that number reaches about log n; on the chain built from a sorted insertion it reaches the size of the tree.',
    }),
  ],
};
