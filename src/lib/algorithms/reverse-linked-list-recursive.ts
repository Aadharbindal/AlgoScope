import { ev } from '../trace/tracer';
import { computed, conceptual } from './checkpoints';
import { build, chainFrom, chainLength, label, World } from './reverse-linked-list';
import { AlgorithmDef, RunFn } from './types';

/**
 * The same reversal, written the other way round.
 *
 * The iterative version carries three pointers and rewires as it walks. This
 * one walks first and rewires on the way back out, which is the same work in
 * the opposite order — and the reason it is here is that the two answer
 * identically while costing differently in the one place that matters: the
 * stack. Every recursive call is a frame, so a list long enough to be
 * interesting is a list long enough to overflow.
 */

const CPP = `Node* reverse(Node* head) {
    if (head == nullptr || head->next == nullptr)
        return head;

    Node* rest = reverse(head->next);

    head->next->next = head;
    head->next = nullptr;

    return rest;
}`;

const C = `struct Node* reverse(struct Node* head) {
    if (head == NULL || head->next == NULL)
        return head;

    struct Node* rest = reverse(head->next);

    head->next->next = head;
    head->next = NULL;

    return rest;
}`;

const JAVA = `Node reverse(Node head) {
    if (head == null || head.next == null)
        return head;

    Node rest = reverse(head.next);

    head.next.next = head;
    head.next = null;

    return rest;
}`;

interface Opts {
  /** The buggy version never cuts the old forward link, leaving a two-cycle. */
  cutOldLink: boolean;
  /** The buggy version hands back the node it was called on, not the new head. */
  returnRest: boolean;
}

/**
 * Nodes still reachable from anywhere we hold a reference.
 *
 * The accounting the iterative version does with two chain lengths does not
 * transfer: while the recursion is unwinding there is a frame for every node,
 * and each of them holds a reference. What is still true, and is the thing
 * worth watching, is that no node ever becomes unreachable — losing one is
 * exactly what rewiring in the wrong order does.
 */
/** Whether following `next` from here ever comes back to a node already seen. */
function loops(w: World, start: string | null): boolean {
  const seen = new Set<string>();
  let at = start;
  while (at !== null) {
    if (seen.has(at)) return true;
    seen.add(at);
    at = w.nodes.get(at)?.next ?? null;
  }
  return false;
}

function reachableCount(w: World, heads: (string | null)[]): number {
  const seen = new Set<string>();
  for (const start of heads) {
    let at = start;
    let guard = w.total + 2;
    while (at !== null && !seen.has(at) && guard-- > 0) {
      seen.add(at);
      at = w.nodes.get(at)?.next ?? null;
    }
  }
  return seen.size;
}

function makeRun(opts: Opts): RunFn {
  return (input, t) => {
    const values = (input.array ?? []).slice();
    const w = build(values);
    const head: string | null = values.length ? 'n0' : null;

    /** Every node the live frames are holding, deepest call last. */
    const held: (string | null)[] = [];
    let newHead: string | null = null;
    /** Calls made, one per node — the claim the stack pays for. */
    let calls = 0;

    t.list('list', w.nodes, () => ({ head, rest: newHead }), 'list');
    t.oracle({ reversed: [...values].reverse().join(',') });

    const mark = () => {
      if (!t.tracing) return;
      t.derive({
        depth: held.length,
        total: w.total,
        reachable: reachableCount(w, [head, newHead, ...held]),
      });
    };

    const reverse = (node: string | null): string | null => {
      calls++;
      t.enter('reverse', `reverse(${label(w, node)})`, {});
      held.push(node);
      mark();
      t.step(1, { node: label(w, node), rest: label(w, newHead) }, `reverse(${label(w, node)}) — one frame deeper.`, ev.call('reverse', `reverse(${label(w, node)})`));

      const atEnd = node === null || w.nodes.get(node)!.next === null;
      t.step(
        2,
        { node: label(w, node), rest: label(w, newHead) },
        atEnd
          ? node === null
            ? 'There is no node here, so there is nothing to reverse.'
            : `${label(w, node)} is the last node, so it is already the head of the reversed list.`
          : `${label(w, node)} has something after it, so the rest has to be reversed first.`,
      );

      if (atEnd) {
        newHead = node;
        mark();
        t.step(3, { node: label(w, node), rest: label(w, newHead) }, `Hand ${label(w, node)} back as the new head.`, ev.ret('reverse', label(w, node)));
        held.pop();
        t.exit();
        return node;
      }

      const after = w.nodes.get(node!)!.next;
      t.step(5, { node: label(w, node), rest: label(w, newHead) }, `Reverse everything after ${label(w, node)} first, and only then fix the one link between them.`);
      const rest = reverse(after);

      // Everything past this node is now reversed and `rest` is its head. This
      // node is still pointing forwards at what is now the *tail* of it, which
      // is exactly the node that should point back here.
      const tail = w.nodes.get(node!)!.next!;
      w.nodes.set(tail, { ...w.nodes.get(tail)!, next: node });
      mark();
      t.step(7, { node: label(w, node), rest: label(w, rest) }, `${label(w, tail)} is the tail of the reversed part, so point it back at ${label(w, node)}.`, ev.link(tail, node));

      if (opts.cutOldLink) {
        w.nodes.set(node!, { ...w.nodes.get(node!)!, next: null });
        mark();
        t.step(8, { node: label(w, node), rest: label(w, rest) }, `Cut ${label(w, node)}'s old forward link — it is the tail now, and a tail points at nothing.`, ev.link(node!, null));
      } else {
        mark();
        t.step(8, { node: label(w, node), rest: label(w, rest) }, `${label(w, node)} keeps pointing forward as well as being pointed back at. Two nodes now point at each other.`);
      }

      const handBack = opts.returnRest ? rest : node;
      newHead = handBack;
      mark();
      t.step(10, { node: label(w, node), rest: label(w, rest) }, opts.returnRest ? `Hand back ${label(w, rest)} — the head of the reversed list, found at the bottom of the recursion.` : `Hand back ${label(w, node)}, the node this call was given.`, ev.ret('reverse', label(w, handBack)));
      held.pop();
      t.exit();
      return handBack;
    };

    t.enter('start', 'reverse(head)');
    if (head === null) {
      t.derive({ depth: 0, total: 0, reachable: 0, reversedOk: 1, calls });
      t.step(2, { node: 'nullptr', rest: 'nullptr' }, 'The list is empty, so there is nothing to reverse.', ev.ret('reverse', null));
      t.exit();
      return '';
    }

    const result = reverse(head);
    newHead = result;

    // A list that loops is not a list, and saying so is the honest answer. The
    // bounded walk below would otherwise print a plausible prefix and hide it.
    const cyclic = loops(w, result);
    const answer = cyclic ? `cycle: the reversed list loops back on itself` : chainFrom(w, result);
    t.derive({
      depth: 0,
      total: w.total,
      reachable: reachableCount(w, [result]),
      reversedOk: answer === [...values].reverse().join(',') ? 1 : 0,
      calls,
    });
    t.step(10, { node: label(w, result), rest: label(w, result) }, `Reversed: ${answer}.`);
    t.exit();
    void chainLength;
    return answer;
  };
}

/** The two authored bugs are the two options, read off the active mutations. */
const run: RunFn = (input, t, mut) =>
  makeRun({ cutOldLink: !mut.has('no-cut'), returnRest: !mut.has('return-node') })(input, t, mut);

export const reverseLinkedListRecursive: AlgorithmDef = {
  slug: 'reverse-linked-list-recursive',
  name: 'Reverse a Linked List — recursive',
  category: 'linked-list',
  tagline: 'Walk to the end first, then turn each arrow around on the way back out.',
  intuition: [
    'The iterative version rewires as it walks forward. This one does the opposite: it walks all the way to the last node without touching anything, and does every rewiring on the way back out.',
    'The trick is what each call knows on its way back. Once the rest of the list is reversed, the node you are standing on is still pointing at what has just become the *tail* of that reversed part — and a tail is exactly the node that should point back at you. So `head->next->next = head` is not a clever line, it is that sentence written down.',
    'Then cut your own forward link, because you are the new tail. Forget that and the two nodes point at each other, which is a cycle rather than a list.',
    'It returns the same list as the iterative version and costs a frame per node to do it. That is the whole trade, and it is why this is the version that overflows the stack on a long list.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'list',
    pointers: [],
    regions: [],
    invariant: {
      text: 'No node has been lost: every original node is still reachable from the head, the reversed part, or a live frame.',
      check: 'reachable === total',
      when: 'defined(total) && total > 0',
      why: 'Rewiring a list is a sequence of moments in which some node is held only by whoever remembered to keep a reference to it. The iterative version needs three pointers for exactly this reason; the recursive one gets its references from the call stack instead, one frame per node. Either way the failure is the same and it is silent: overwrite a link before something else points at what it led to, and a node is simply gone.',
    },
    postcondition: {
      text: 'The list handed back is the original read backwards.',
      check: 'reversedOk === 1',
      why: 'The same promise the iterative version makes, and the reason both are here: to a caller these two functions are interchangeable, so the only honest way to compare them is on what they cost rather than on what they return.',
    },
    cost: {
      text: 'One call per node, and the recursion goes as deep as the list is long.',
      check: 'calls === n && ops_maxDepth >= n',
      why: 'This is the whole difference from the iterative version, and it is invisible in the answer — the two return the same list. A frame per node is fine at ten and fatal at a million, which is a real limit rather than a stylistic preference. The measured space on this page is the same statement made by experiment.',
    },
  },
  run,
  defaultInput: { array: [10, 20, 30, 40] },
  fields: [{ key: 'array', label: 'List values', kind: 'array', help: 'Head is on the left.' }],
  makeInput: (n) => ({ array: Array.from({ length: n }, (_, k) => k + 1) }),
  growthSizes: [8, 16, 32, 64, 128, 256, 512],
  projectTo: 1_000_000,
  complexity: {
    time: 'O(n)',
    space: 'O(n) — one stack frame per node',
    note: 'Identical work to the iterative version and a completely different space bill. The iterative one holds three pointers whatever the length; this one holds a frame per node, so the space grows with the input. That is the only difference between them, and it is the reason the iterative version is the one you write in an interview.',
  },
  mutations: [
    {
      id: 'no-cut',
      edits: [
        { line: 8, from: 'head->next = nullptr;', to: '// head->next = nullptr;', langs: ['cpp'] },
        { line: 8, from: 'head->next = NULL;', to: '/* head->next = NULL; */', langs: ['c'] },
        { line: 8, from: 'head.next = null;', to: '// head.next = null;', langs: ['java'] },
      ],
      label: 'never cut the old link',
      note: 'Leaves each node pointing both forwards and backwards, so the last two nodes point at each other.',
    },
    {
      id: 'return-node',
      edits: [
        { line: 10, from: 'return rest;', to: 'return head;', langs: ['cpp', 'c', 'java'] },
      ],
      label: 'return head instead of rest',
      note: 'Hands back the node this call was given rather than the head found at the bottom of the recursion.',
    },
  ],
  variants: [
    {
      id: 'no-cut',
      label: 'The old link is never cut',
      blurb: 'The list comes back shorter than it went in.',
      explanation:
        'Every call adds the backward arrow and leaves the forward one in place, so the last two nodes end up pointing at each other. That is a cycle, not a list — anything that walks it either never finishes or, as here, stops at the bound and returns a fragment. The line that was skipped says "I am the tail now", and a tail points at nothing.',
      mutations: ['no-cut'],
    },
    {
      id: 'return-node',
      label: 'The wrong node is returned',
      blurb: 'The list is reversed correctly and the caller only sees one node of it.',
      explanation:
        'The rewiring is perfect — every arrow ends up where it belongs. What is wrong is which node comes back. The new head is found at the very bottom of the recursion and has to be passed up untouched through every frame; returning the node this call happens to be standing on hands the caller what is now the last node instead of the first.',
      mutations: ['return-node'],
    },
  ],
  edgeCases: [
    { id: 'four', label: 'Four nodes', input: { array: [10, 20, 30, 40] }, why: 'Deep enough that the return journey does real work, short enough to follow.' },
    { id: 'two', label: 'Two nodes', input: { array: [1, 2] }, why: 'The smallest list where anything is rewired at all — and the smallest one the missing cut turns into a cycle.' },
    { id: 'one', label: 'One node', input: { array: [7] }, why: 'The base case is hit immediately and nothing is rewired.' },
    { id: 'empty', label: 'Empty list', input: { array: [] }, why: 'The first call returns without recursing. A reversal of nothing is nothing.' },
    { id: 'long', label: 'Ten nodes', input: { array: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }, why: 'Ten frames deep. Watch the call stack, which is the whole reason this version is worth comparing.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 5, nth: 1 },
      question: 'This call recurses before it rewires anything. What has to be true when that call returns?',
      options: [
        'Everything after this node is already reversed, and rest is its head',
        'The whole list is reversed',
        'Nothing — the rewiring happens on the way down',
        'This node has been moved to the end',
      ],
      answer: 'Everything after this node is already reversed, and rest is its head',
      because:
        'That assumption is the whole of the recursion, and it is what lets the next two lines be so short. This call does not have to reverse the rest — it gets to assume the rest is done and only fixes the single link between itself and it.',
    }),
    conceptual({
      where: { line: 7, nth: 1 },
      question: 'Why is head->next the right node to point back at head?',
      options: [
        'Because after the rest was reversed it became the tail of that part',
        'Because it is the smallest value left',
        'Because it is the new head of the whole list',
        'It is arbitrary — any node would do',
      ],
      answer: 'Because after the rest was reversed it became the tail of that part',
      because:
        'head->next has not been changed by anything yet, so it still names the node that used to come next — and reversing that sublist turned it into the last node of it. The one arrow still missing is the one from that tail back to here.',
    }),
    computed({
      where: { line: 1, nth: 3 },
      question: () => 'How many frames are on the stack at this moment?',
      answer: (step) => String(step.frames.length - 1),
      options: (answer) => {
        const d = Number(answer);
        return [String(d), '1', String(d + 1), String(Math.max(1, d - 1))];
      },
      because:
        'One frame per node reached so far, and none of them can be released until the deepest call returns. That is the space this version spends and the iterative one does not.',
    }),
  ],
};
