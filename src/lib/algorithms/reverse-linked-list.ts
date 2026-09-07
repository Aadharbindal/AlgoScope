import { ev, lit, vr } from '../trace/tracer';
import { Tracer } from '../trace/tracer';
import { ListNode } from '../trace/types';
import { computed, conceptual } from './checkpoints';
import { AlgorithmDef, RunFn } from './types';

const CPP = `Node* reverse(Node* head) {
    Node* prev = nullptr;
    Node* curr = head;

    while (curr != nullptr) {
        Node* next = curr->next;
        curr->next = prev;
        prev = curr;
        curr = next;
    }

    return prev;
}`;

const C = `struct Node* reverse(struct Node* head) {
    struct Node* prev = NULL;
    struct Node* curr = head;

    while (curr != NULL) {
        struct Node* next = curr->next;
        curr->next = prev;
        prev = curr;
        curr = next;
    }

    return prev;
}`;

const JAVA = `Node reverse(Node head) {
    Node prev = null;
    Node curr = head;

    while (curr != null) {
        Node next = curr.next;
        curr.next = prev;
        prev = curr;
        curr = next;
    }

    return prev;
}`;

interface World {
  nodes: Map<string, ListNode>;
  total: number;
}

function build(values: number[]): World {
  const nodes = new Map<string, ListNode>();
  values.forEach((v, k) => {
    nodes.set(`n${k}`, { id: `n${k}`, value: v, next: k < values.length - 1 ? `n${k + 1}` : null });
  });
  return { nodes, total: values.length };
}

/** Walk a chain, refusing to loop forever if a bug has created a cycle. */
function chainLength(w: World, start: string | null): number {
  let len = 0;
  let at = start;
  const seen = new Set<string>();
  while (at && !seen.has(at) && len <= w.total + 1) {
    seen.add(at);
    len++;
    at = w.nodes.get(at)?.next ?? null;
  }
  return len;
}

/**
 * Publish the node accounting.
 *
 * `remainder` is the head of the still-forward-pointing chain, which is curr
 * for most of the loop but becomes next during the window in which curr has
 * been flipped and prev has not yet caught up. In that window curr belongs to
 * neither chain — it is in flight — and that is worth showing rather than
 * smoothing over.
 */
function markCounts(
  t: Tracer,
  w: World,
  prev: string | null,
  remainder: string | null,
  inFlight: 0 | 1,
) {
  if (!t.tracing) return;
  t.derive({
    reversedLen: chainLength(w, prev),
    remainingLen: chainLength(w, remainder),
    inFlight,
    total: w.total,
  });
}

/**
 * Values along `next` from a node, for checking the result.
 *
 * Bounded, because the very bug being looked for can leave a list pointing at
 * itself — a postcondition that hangs on a broken input is not a check.
 */
function chainFrom(w: World, id: string | null): string {
  const out: number[] = [];
  const seen = new Set<string>();
  let at = id;
  while (at !== null && !seen.has(at) && out.length <= w.total) {
    seen.add(at);
    const node = w.nodes.get(at);
    if (!node) break;
    out.push(node.value);
    at = node.next;
  }
  return out.join(',');
}

const label = (w: World, id: string | null) => (id === null ? 'nullptr' : String(w.nodes.get(id)?.value));

interface Opts {
  /** The buggy version reads curr->next after it has already been overwritten. */
  saveNextFirst: boolean;
  returnHead: boolean;
}

function makeRun(opts: Opts): RunFn {
  return (input, t) => {
    const values = (input.array ?? []).slice();
    const w = build(values);
    const head: string | null = values.length ? 'n0' : null;

    let prev: string | null = null;
    let curr: string | null = null;
    let next: string | null = null;

    // A pointer variable is shown by the value it names, with the node id kept
    // for precision — two nodes can hold the same value, and confusing them is
    // exactly the mistake this algorithm punishes.
    const ref = (id: string | null) =>
      id === null ? 'nullptr' : `${w.nodes.get(id)!.value} (${id})`;
    const V = () => ({ prev: ref(prev), curr: ref(curr), next: ref(next) });

    t.list('list', w.nodes, () => ({ head, prev, curr, next }), 'list');
    t.enter('reverse', 'reverse(head)');

    t.step(1, V(), `A ${values.length}-node list. The goal is to make every arrow point the other way, without allocating anything new.`, ev.call('reverse', 'reverse(head)'));

    prev = null;
    t.step(2, V(), 'prev is the head of the part already reversed. Nothing is reversed yet, so it is null — and that null is what becomes the new tail.');

    curr = head;
    markCounts(t, w, prev, curr, 0);
    t.step(3, V(), () => `curr is the node being rewired right now: ${label(w, curr)}.`);

    for (;;) {
      const keepGoing = curr !== null;
      t.step(5, V(), () => (keepGoing ? `curr points at ${label(w, curr)}, so there is still a node to flip.` : 'curr is null — every node has been rewired.'), ev.cmp(vr('curr'), '!=', lit(null), keepGoing));
      if (!keepGoing) break;
      t.tick();

      if (opts.saveNextFirst) {
        next = w.nodes.get(curr!)!.next;
        markCounts(t, w, prev, curr, 0);
        t.step(6, V(), () => `Save the rest of the list in next (${label(w, next)}) before touching curr->next. This one line is the whole reason the algorithm works.`, ev.readNode('list', curr!));
      }

      const node = w.nodes.get(curr!)!;
      const oldNext = node.next;
      node.next = prev;
      // curr now belongs to neither chain: it points backwards, but prev has
      // not yet been moved onto it. `next` is the only handle on the rest.
      markCounts(t, w, prev, next, 1);
      t.step(7, V(), () => `Flip the arrow: ${label(w, curr)} now points back at ${label(w, prev)} instead of forward at ${oldNext === null ? 'nullptr' : label(w, oldNext)}.`, ev.link(curr!, prev));

      prev = curr;
      markCounts(t, w, prev, next, 0);
      t.step(8, V(), () => `The reversed part now starts at ${label(w, prev)}.`);

      if (opts.saveNextFirst) {
        curr = next;
      } else {
        // BUG: curr->next was overwritten on line 7, so this walks backwards.
        curr = w.nodes.get(prev!)!.next;
      }
      markCounts(t, w, prev, curr, 0);
      t.step(9, V(), () => `Move curr on to ${label(w, curr)}.`);
    }

    const out = opts.returnHead ? head : prev;
    // Walk what is being handed back and compare it with the input read
    // backwards. Returning the old head satisfies every step-by-step claim the
    // loop makes and fails here on the first node.
    t.derive({ reversedOk: chainFrom(w, out) === values.slice().reverse().join(',') ? 1 : 0 });
    t.step(12, V(), () => `Returning ${label(w, out)} as the new head.`, ev.ret('reverse', out));
    t.exit();

    const order: number[] = [];
    let at: string | null = out;
    const seen = new Set<string>();
    while (at && !seen.has(at)) {
      seen.add(at);
      order.push(w.nodes.get(at)!.value);
      at = w.nodes.get(at)!.next;
    }
    return order.join(',');
  };
}

const run: RunFn = (input, t, mut) =>
  makeRun({
    saveNextFirst: !mut.has('lost-next'),
    returnHead: mut.has('return-head'),
  })(input, t, mut);

export const reverseLinkedList: AlgorithmDef = {
  slug: 'reverse-linked-list',
  name: 'Reverse a Linked List',
  category: 'linked-list',
  tagline: 'Walk the list once, turning every arrow around as you pass it.',
  intuition: [
    'You cannot reverse a linked list by moving values around — the whole point is that the nodes stay where they are and the arrows change direction.',
    'Hold three references. prev is the front of the piece you have already reversed. curr is the node you are rewiring right now. next is your grip on the rest of the list, because the instant you point curr backwards you lose the only reference you had to what came after it.',
    'That is the entire problem, and it is why this question gets asked so often: the three-pointer dance is a small, exact test of whether you understand that a pointer is a name for a node, not the node itself.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'list',
    pointers: [],
    regions: [],
    invariant: {
      text: 'Reversed nodes + remaining nodes + the one in flight always equals the original length.',
      check: 'reversedLen + remainingLen + inFlight === total',
      when: 'defined(total)',
      why: 'While the loop runs, the list is split into the reversed part behind prev and the untouched part ahead. There is also a single instant — between flipping curr and moving prev onto it — when curr belongs to neither, which is why the count has a third term. If this total ever drops below the original length, nodes have become unreachable, and that is precisely what overwriting curr->next before saving it does.',
    },
    postcondition: {
      text: 'The list handed back is the original read backwards.',
      check: 'reversedOk === 1',
      why: 'The invariant counts nodes, which a version that returns the wrong end of the list satisfies perfectly — every node is still accounted for, at every step. What is wrong is which node was handed back, and that is a fact about the result rather than about the loop.',
    },
    cost: {
      text: 'Every node is visited exactly once — the walk neither skips a node nor goes round twice.',
      check: 'ops_iterations === n',
      why: 'A reversal that loses the rest of the list ends early; one that rewires into a cycle would never end at all. Both are the same mistake seen from different sides, and the node count is where either shows immediately — before the returned list is even inspected.',
    },
  },
  run,
  defaultInput: { array: [10, 20, 30, 40] },
  fields: [{ key: 'array', label: 'List values', kind: 'array', help: 'Head is on the left.' }],
  makeInput: (n) => ({ array: Array.from({ length: n }, (_, k) => k + 1) }),
  growthSizes: [8, 16, 32, 64, 128, 256, 512, 1024],
  projectTo: 1_000_000,
  complexity: {
    time: 'O(n)',
    space: 'O(1)',
    note: 'Each node is visited exactly once, and only three pointers are held regardless of list length. The recursive version is also O(n) time but O(n) space, because every node gets a stack frame.',
  },
  userLane: {
    fnName: 'reverse',
    compareBy: 'return',
    binds: 'list',
    starters: {
      cpp: `struct Node {
    int val;
    Node* next;
};

Node* reverse(Node* head) {
    Node* prev = nullptr;
    Node* curr = head;

    while (curr != nullptr) {
        Node* next = curr->next;
        curr->next = prev;
        prev = curr;
        curr = next;
    }

    return prev;
}`,
      c: `struct Node {
    int val;
    struct Node* next;
};

struct Node* reverse(struct Node* head) {
    struct Node* prev = NULL;
    struct Node* curr = head;

    while (curr != NULL) {
        struct Node* next = curr->next;
        curr->next = prev;
        prev = curr;
        curr = next;
    }

    return prev;
}`,
      java: `class Node {
    int val;
    Node next;
}

Node reverse(Node head) {
    Node prev = null;
    Node curr = head;

    while (curr != null) {
        Node next = curr.next;
        curr.next = prev;
        prev = curr;
        curr = next;
    }

    return prev;
}`,
    },
  },
  mutations: [
    {
      id: 'lost-next',
      edits: [
        { line: 6, from: 'Node* next = curr->next;', to: '// Node* next = curr->next;', langs: ['cpp'] },
        { line: 6, from: 'struct Node* next = curr->next;', to: '// struct Node* next = curr->next;', langs: ['c'] },
        { line: 6, from: 'Node next = curr.next;', to: '// Node next = curr.next;', langs: ['java'] },
        { line: 9, from: 'curr = next;', to: 'curr = curr->next;', langs: ['cpp', 'c'] },
        { line: 9, from: 'curr = next;', to: 'curr = curr.next;', langs: ['java'] },
      ],
      label: 'never save next',
      note: 'Reads curr->next after it has already been overwritten, so curr walks backwards.',
    },
    {
      id: 'return-head',
      edits: [{ line: 12, from: 'return prev;', to: 'return head;' }],
      label: 'return head',
      note: 'Hands back the original first node, which after reversal is the tail.',
    },
  ],
  variants: [
    {
      id: 'lost-next',
      label: 'next is never saved',
      blurb: 'Returns a list with almost every node missing.',
      explanation:
        'Line 7 overwrites curr->next with prev. Reading curr->next afterwards therefore gives you prev — the node you just came from — so curr walks backwards into the part you already reversed instead of forwards into the part you have not. The rest of the list is unreachable from that moment on, and the invariant catches it on the very first iteration.',
      mutations: ['lost-next'],
    },
    {
      id: 'return-head',
      label: 'return head',
      blurb: 'Returns a list containing exactly one node.',
      explanation:
        'The loop is correct — every arrow does get flipped. But head still names the original first node, and after reversal that node is the tail, whose next is null. Returning it hands back a perfectly valid one-element list. When the loop ends, prev is the only reference to the new front.',
      mutations: ['return-head'],
    },
  ],
  edgeCases: [
    { id: 'empty', label: 'Empty list', input: { array: [] }, why: 'curr is null immediately, prev is null, and null is the correct answer. Many implementations crash here instead.' },
    { id: 'single', label: 'One node', input: { array: [7] }, why: 'One iteration. The node points at null before and after — the only thing that changes is which variable names it.' },
    { id: 'two', label: 'Two nodes', input: { array: [1, 2] }, why: 'The smallest case where losing next actually costs you something.' },
    { id: 'dupes', label: 'Duplicate values', input: { array: [5, 5, 5] }, why: 'A reminder that pointers identify nodes, not values. Two nodes holding 5 are still two different nodes.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 7, nth: 1 },
      question: 'This line has just cut curr off from the rest of the list. What still holds the rest?',
      options: [
        'next, which was saved on the line above',
        'prev',
        'head',
        'Nothing — it is unreachable',
      ],
      answer: 'next, which was saved on the line above',
      because:
        'For one moment the list is in two pieces and curr belongs to neither: the reversed part behind it and the untouched part ahead, joined by nothing but the local variable next. That is the entire reason the save has to happen before the rewrite, and it is why this loop is four lines rather than three.',
    }),
    conceptual({
      where: { line: 8, nth: 1 },
      question: 'prev and curr both move forward each round. Why does prev end up being the answer?',
      options: [
        'Because curr runs off the end, and prev is one behind it',
        'Because prev is the head of the original list',
        'Because curr is null and prev is not',
        'Because prev points at the largest value',
      ],
      answer: 'Because curr runs off the end, and prev is one behind it',
      because:
        'The loop stops when curr is null, which is one step past the last real node — and prev is always exactly one node behind. So prev is sitting on the final node of the original list, which after the rewiring is the first node of the reversed one. Returning head instead gives you the old head, now a one-node list.',
    }),
    computed({
      where: { line: 5, nth: -1 },
      question: () => 'The loop is about to end. How many times has each node been visited?',
      answer: () => 'Exactly once',
      options: (a) => [a, 'Twice', 'It depends on the length', 'Once for each pointer'],
      because:
        'Three pointers move forward together and never go back, so the whole reversal is a single pass — linear time and constant extra space. Reversing by building a new list would also be linear in time but would allocate n nodes; this rewires the ones already there.',
    }),
    {
      locate: (trace) => trace.steps.findIndex((s) => s.line === 7),
      question: () => 'Line 7 is about to overwrite curr->next. If the line above it were deleted, what would be lost?',
      options: () => [
        'Nothing — curr->next can be read again afterwards',
        'The reference to the rest of the unreversed list',
        'The reference to the already-reversed part',
        'The value stored inside curr',
      ],
      answer: () => 'The reference to the rest of the unreversed list',
      because: () =>
        'curr->next is the only name the program has for everything after curr. Once it is overwritten with prev, that entire remainder is unreachable — nothing else refers to it. Saving it into next first is not a convenience, it is the only way the loop can continue.',
    },
  ],
};
