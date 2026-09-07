import { ev, lit, vr } from '../trace/tracer';
import { Tracer } from '../trace/tracer';
import { ListNode } from '../trace/types';
import { computed, conceptual } from './checkpoints';
import { AlgorithmDef, RunFn } from './types';

const CPP = `bool hasCycle(Node* head) {
    Node* slow = head;
    Node* fast = head;

    while (fast != nullptr && fast->next != nullptr) {
        slow = slow->next;
        fast = fast->next->next;

        if (slow == fast)
            return true;
    }

    return false;
}`;

const C = `int hasCycle(struct Node* head) {
    struct Node* slow = head;
    struct Node* fast = head;

    while (fast != NULL && fast->next != NULL) {
        slow = slow->next;
        fast = fast->next->next;

        if (slow == fast)
            return 1;
    }

    return 0;
}`;

const JAVA = `boolean hasCycle(Node head) {
    Node slow = head;
    Node fast = head;

    while (fast != null && fast.next != null) {
        slow = slow.next;
        fast = fast.next.next;

        if (slow == fast)
            return true;
    }

    return false;
}`;

interface World {
  nodes: Map<string, ListNode>;
  cycleAt: number;
}

function build(values: number[], cycleAt: number): World {
  const nodes = new Map<string, ListNode>();
  values.forEach((v, k) => {
    const last = k === values.length - 1;
    const next = last ? (cycleAt >= 0 && cycleAt < values.length ? `n${cycleAt}` : null) : `n${k + 1}`;
    nodes.set(`n${k}`, { id: `n${k}`, value: v, next });
  });
  return { nodes, cycleAt };
}

/**
 * The two-to-one ratio is a property of a completed round. Between slow's hop
 * and fast's the counts are legitimately out of step, so those moments are
 * marked unsettled rather than reported as a broken invariant.
 */
function markSteps(t: Tracer, slowSteps: number, fastSteps: number, settled: 0 | 1) {
  if (!t.tracing) return;
  t.derive({ slowSteps, fastSteps, settled });
}

/**
 * Whether following `next` from the head ever revisits a node.
 *
 * The definition, walked with a set — slow, and deliberately so. A
 * postcondition states what the answer means; it is not a second, cleverer
 * attempt at computing it, and writing it the obvious way is what keeps it
 * independent of the implementation it is judging.
 */
function reallyHasCycle(w: World, head: string | null): boolean {
  const seen = new Set<string>();
  let at = head;
  while (at !== null) {
    if (seen.has(at)) return true;
    seen.add(at);
    at = w.nodes.get(at)?.next ?? null;
  }
  return false;
}

interface Opts {
  /** The buggy loop drops the guard that keeps fast->next legal. */
  guardNextOfNext: boolean;
}

function makeRun(opts: Opts): RunFn {
  return (input, t) => {
    const values = (input.array ?? []).slice();
    const cycleAt = Number(input.target ?? -1);
    const w = build(values, cycleAt);
    const head: string | null = values.length ? 'n0' : null;

    let slow: string | null = null;
    let fast: string | null = null;
    let slowSteps = 0;
    let fastSteps = 0;

    const label = (id: string | null) => (id === null ? 'nullptr' : `${w.nodes.get(id)!.value} (${id})`);
    const V = () => ({ slow: label(slow), fast: label(fast) });
    const nextOf = (id: string) => w.nodes.get(id)!.next;

    t.list('list', w.nodes, () => ({ head, slow, fast }), 'list');
    t.oracle({ trulyCyclic: cycleAt >= 0 && cycleAt < values.length ? 1 : 0 });
    t.enter('hasCycle', 'hasCycle(head)');

    t.step(1, V(), `A ${values.length}-node list. The question is whether following next forever ever revisits a node.`, ev.call('hasCycle', 'hasCycle(head)'));

    slow = head;
    markSteps(t, slowSteps, fastSteps, 1);
    t.step(2, V(), () => `slow starts at the head: ${label(slow)}.`);

    fast = head;
    t.step(3, V(), () => `fast starts at the head too. They separate only once the loop begins.`);

    for (;;) {
      const fastOk = fast !== null;
      const nextOk = fastOk && (opts.guardNextOfNext ? nextOf(fast!) !== null : true);
      const keepGoing = fastOk && nextOk;
      t.step(
        5,
        V(),
        () =>
          !fastOk
            ? 'fast has run off the end of the list. There is no cycle — a cycle has no end to run off.'
            : !nextOk
              ? 'fast is on the last node, so it cannot take two steps. The list ends here: no cycle.'
              : `fast can still take two steps, so keep going.`,
        ev.cmp(vr('fast'), '!=', lit(null), keepGoing),
      );
      if (!keepGoing) break;
      t.tick();

      slow = nextOf(slow!);
      slowSteps++;
      markSteps(t, slowSteps, fastSteps, 0);
      t.step(6, V(), () => `slow takes one step, to ${label(slow)}.`, ev.readNode('list', fast!));

      // Two hops. Without the guard, the second one dereferences a null next.
      const mid = nextOf(fast!);
      fast = nextOf(mid!);
      fastSteps += 2;
      markSteps(t, slowSteps, fastSteps, 1);
      t.step(7, V(), () => `fast takes two steps, to ${label(fast)}.`);

      const met = slow === fast && slow !== null;
      t.step(9, V(), () => (met ? `slow and fast are on the same node, ${label(slow)}. They could only meet by going round.` : `slow is at ${label(slow)}, fast at ${label(fast)}. Not the same node.`), ev.cmp(vr('slow'), '==', vr('fast'), met));

      if (met) {
        t.derive({ verdictOk: reallyHasCycle(w, head) === true ? 1 : 0 });
        t.step(10, V(), 'There is a cycle.', ev.ret('hasCycle', true));
        t.exit();
        return 'true';
      }
    }

    // The definition, walked the slow obvious way, on the other exit too — a
    // postcondition that is only derived on one path is not a postcondition.
    t.derive({ verdictOk: reallyHasCycle(w, head) === false ? 1 : 0 });
    t.step(13, V(), 'Reached the end of the list without the two pointers ever meeting. No cycle.', ev.ret('hasCycle', false));
    t.exit();
    return 'false';
  };
}

const runTwoStep = makeRun({ guardNextOfNext: true });
const runNoGuard = makeRun({ guardNextOfNext: false });

/** The same-speed bug needs its own walk, since fast only moves one node. */
const runSameSpeedReal: RunFn = (input, t) => {
  const values = (input.array ?? []).slice();
  const cycleAt = Number(input.target ?? -1);
  const w = build(values, cycleAt);
  const head: string | null = values.length ? 'n0' : null;

  let slow: string | null = null;
  let fast: string | null = null;
  let slowSteps = 0;
  let fastSteps = 0;

  const label = (id: string | null) => (id === null ? 'nullptr' : `${w.nodes.get(id)!.value} (${id})`);
  const V = () => ({ slow: label(slow), fast: label(fast) });
  const nextOf = (id: string) => w.nodes.get(id)!.next;

  t.list('list', w.nodes, () => ({ head, slow, fast }), 'list');
  t.oracle({ trulyCyclic: cycleAt >= 0 && cycleAt < values.length ? 1 : 0 });
  t.enter('hasCycle', 'hasCycle(head)');
  t.step(1, V(), `A ${values.length}-node list.`, ev.call('hasCycle', 'hasCycle(head)'));

  slow = head;
  t.derive({ slowSteps, fastSteps, settled: 1 });
  t.step(2, V(), () => `slow starts at ${label(slow)}.`);
  fast = head;
  t.step(3, V(), () => `fast starts at ${label(fast)}.`);

  for (;;) {
    const keepGoing = fast !== null && nextOf(fast) !== null;
    t.step(5, V(), () => (keepGoing ? 'fast can still advance.' : 'fast has reached the end.'), ev.cmp(vr('fast'), '!=', lit(null), keepGoing));
    if (!keepGoing) break;
    t.tick();

    slow = nextOf(slow!);
    slowSteps++;
    t.derive({ slowSteps, fastSteps, settled: 0 });
    t.step(6, V(), () => `slow takes one step, to ${label(slow)}.`);

    fast = nextOf(fast!);
    fastSteps++;
    t.derive({ slowSteps, fastSteps, settled: 1 });
    t.step(7, V(), () => `fast takes one step, to ${label(fast)}.`);

    const met = slow === fast && slow !== null;
    t.step(9, V(), () => (met ? `slow and fast are both on ${label(slow)}.` : 'Not the same node.'), ev.cmp(vr('slow'), '==', vr('fast'), met));
    if (met) {
      t.derive({ verdictOk: reallyHasCycle(w, head) === true ? 1 : 0 });
      t.step(10, V(), 'Reporting a cycle.', ev.ret('hasCycle', true));
      t.exit();
      return 'true';
    }
  }

  // The definition, walked the slow obvious way. A postcondition is allowed to
  // be expensive: it says what the answer means, it does not recompute it
  // cleverly.
  t.derive({ verdictOk: reallyHasCycle(w, head) === false ? 1 : 0 });
  t.step(13, V(), 'No cycle.', ev.ret('hasCycle', false));
  t.exit();
  return 'false';
};

/**
 * The same-speed bug changes how far fast travels, which is a different walk
 * rather than a flag inside the shared one — so it dispatches to its own run.
 */
const run: RunFn = (input, t, mut) => {
  if (mut.has('same-speed')) return runSameSpeedReal(input, t, mut);
  if (mut.has('no-guard')) return runNoGuard(input, t, mut);
  return runTwoStep(input, t, mut);
};

export const cycleDetection: AlgorithmDef = {
  slug: 'cycle-detection',
  name: "Cycle Detection (Floyd's)",
  category: 'linked-list',
  tagline: 'Two pointers at different speeds — if the track loops, they must collide.',
  intuition: [
    'You cannot tell whether a linked list loops by walking it, because a loop has no end to arrive at. You could remember every node you have visited, but that costs O(n) memory.',
    'Floyd\'s trick uses two walkers instead of a notebook. One takes a single step at a time, the other takes two. On a straight list the fast one runs off the end and the question is settled. On a looping list neither can ever leave, and the fast one closes the gap by exactly one node each round — so it must eventually land on the slow one.',
    'That "closes by exactly one" is the whole proof. The gap cannot skip over zero, so a collision is guaranteed rather than likely. Watch slowSteps and fastSteps in the derived values: fast is always at exactly double.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'list',
    pointers: [],
    regions: [],
    invariant: {
      text: 'fast has always travelled exactly twice as many nodes as slow.',
      check: 'fastSteps === 2 * slowSteps',
      when: 'defined(slowSteps) && defined(settled) && settled === 1',
      why: 'The whole argument depends on the gap between the two pointers growing by exactly one per round. If the speeds are not one and two, either they never close the gap or they can step over each other, and a real cycle goes undetected — or a straight list gets reported as looping.',
    },
    postcondition: {
      text: 'The answer matches whether following next from the head ever revisits a node.',
      check: 'verdictOk === 1',
      why: 'Checked by walking the list with a set of everything seen — slow, and allowed to be, because it is the definition rather than the algorithm. That is what a postcondition is for: it may be written the obvious expensive way, being a statement of what the answer means rather than a second attempt at computing it.',
    },
    cost: {
      text: 'The two pointers meet, or run off the end, within one pass of the list — never more steps than there are nodes.',
      check: 'ops_iterations <= n',
      why: 'This is the part of Floyd’s that is genuinely surprising and easy to get wrong: because the gap between the pointers closes by exactly one node per round, they are guaranteed to meet inside a single lap. Change the speeds and the algorithm still answers correctly on plenty of inputs while quietly losing that guarantee — and a bound that no longer holds is not a bound.',
    },
  },
  run,
  defaultInput: { array: [3, 2, 0, 4, 7], target: 1 },
  fields: [
    { key: 'array', label: 'Node values', kind: 'array', help: 'Head is on the left.' },
    { key: 'target', label: 'Last node links back to index', kind: 'number' },
  ],
  makeInput: (n) => ({ array: Array.from({ length: n }, (_, k) => k + 1), target: -1 }),
  growthSizes: [8, 16, 32, 64, 128, 256, 512, 1024],
  projectTo: 1_000_000,
  complexity: {
    time: 'O(n)',
    space: 'O(1)',
    note: 'On a straight list, fast reaches the end after n/2 rounds. On a cyclic one the pointers meet within one lap of the loop. Either way the memory used is two pointers — which is the entire reason to prefer this over a visited set.',
  },
  userLane: {
    fnName: 'hasCycle',
    compareBy: 'return',
    binds: 'list',
    starters: {
      cpp: `struct Node {
    int val;
    Node* next;
};

bool hasCycle(Node* head) {
    Node* slow = head;
    Node* fast = head;

    while (fast != nullptr && fast->next != nullptr) {
        slow = slow->next;
        fast = fast->next->next;

        if (slow == fast)
            return true;
    }

    return false;
}`,
      c: `struct Node {
    int val;
    struct Node* next;
};

bool hasCycle(struct Node* head) {
    struct Node* slow = head;
    struct Node* fast = head;

    while (fast != NULL && fast->next != NULL) {
        slow = slow->next;
        fast = fast->next->next;

        if (slow == fast)
            return true;
    }

    return false;
}`,
      java: `class Node {
    int val;
    Node next;
}

boolean hasCycle(Node head) {
    Node slow = head;
    Node fast = head;

    while (fast != null && fast.next != null) {
        slow = slow.next;
        fast = fast.next.next;

        if (slow == fast)
            return true;
    }

    return false;
}`,
    },
  },
  mutations: [
    {
      id: 'same-speed',
      edits: [
        { line: 7, from: 'fast = fast->next->next;', to: 'fast = fast->next;', langs: ['cpp', 'c'] },
        { line: 7, from: 'fast = fast.next.next;', to: 'fast = fast.next;', langs: ['java'] },
      ],
      label: 'fast takes one step',
      note: 'Both pointers move together, so they are equal after every round and the test fires at once.',
    },
    {
      id: 'no-guard',
      edits: [
        {
          line: 5,
          from: 'while (fast != nullptr && fast->next != nullptr)',
          to: 'while (fast != nullptr)',
          langs: ['cpp'],
        },
        {
          line: 5,
          from: 'while (fast != NULL && fast->next != NULL)',
          to: 'while (fast != NULL)',
          langs: ['c'],
        },
        {
          line: 5,
          from: 'while (fast != null && fast.next != null)',
          to: 'while (fast != null)',
          langs: ['java'],
        },
      ],
      label: 'drop the second guard',
      note: 'Only proves one hop is legal before taking two, so fast->next->next can dereference null.',
    },
  ],
  variants: [
    {
      id: 'same-speed',
      label: 'fast = fast->next',
      blurb: 'Reports a cycle in every non-empty list, including straight ones.',
      explanation:
        'Both pointers start on the head and now move at the same speed, so they are on the same node after every single round — and the equality test fires immediately. The gap never grows, so it never has to close. The two different speeds are not an optimisation; they are what makes the meeting mean something.',
      mutations: ['same-speed'],
    },
    {
      id: 'no-guard',
      label: 'while (fast != nullptr)',
      blurb: 'Crashes on a straight list of even length.',
      explanation:
        'fast takes two hops per round, so it needs *two* nodes ahead of it to be safe — checking only the first is not enough. When fast lands on the final node, fast->next is null and fast->next->next dereferences it. The && is doing real work: it proves both hops are legal before either is taken.',
      mutations: ['no-guard'],
    },
  ],
  edgeCases: [
    { id: 'cycle-mid', label: 'Loops back to the middle', input: { array: [3, 2, 0, 4, 7], target: 1 }, why: 'The classic shape. The pointers meet inside the loop, not at its entry point.' },
    { id: 'cycle-self', label: 'Last node points to itself', input: { array: [1, 2, 3], target: 2 }, why: 'A loop of length one. fast and slow land on it together.' },
    { id: 'cycle-full', label: 'Whole list is a ring', input: { array: [1, 2, 3, 4], target: 0 }, why: 'No node is outside the loop.' },
    { id: 'straight-even', label: 'Straight, even length', input: { array: [1, 2, 3, 4], target: -1 }, why: 'fast lands exactly on the last node, where fast->next is null. This is the case the missing guard dereferences.' },
    { id: 'straight-odd', label: 'Straight, odd length', input: { array: [1, 2, 3], target: -1 }, why: 'fast steps clean off the end to null instead.' },
    { id: 'single', label: 'One node, no cycle', input: { array: [9], target: -1 }, why: 'The loop condition fails immediately.' },
    { id: 'empty', label: 'Empty list', input: { array: [], target: -1 }, why: 'Both pointers start null. Everything must survive that.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 6, nth: 1 },
      question: 'Why does the fast pointer move two steps and not three?',
      options: [
        'Two is enough, and larger steps can skip past the meeting point',
        'Three would be faster',
        'Two is required for the maths to work at all',
        'It is arbitrary',
      ],
      answer: 'Two is enough, and larger steps can skip past the meeting point',
      because:
        'With a gap that closes by exactly one each round, the two pointers cannot pass each other without landing together. Close the gap by two and they can step over one another and go round again — it still terminates, but the tidy argument for why is gone. Two is the smallest step that works, which is the reason to choose it.',
    }),
    conceptual({
      where: { line: 5, nth: 2 },
      question: 'Why does the loop test both fast and fast->next for null?',
      options: [
        'Because fast moves two steps, and either one can run off the end',
        'To make the loop faster',
        'Because slow may be null too',
        'It is redundant — one check would do',
      ],
      answer: 'Because fast moves two steps, and either one can run off the end',
      because:
        'Checking only fast lets the second hop dereference null on a list of even length. It is the classic crash in this function, and it is invisible on odd-length lists — so it passes half the tests you would think to write.',
    }),
    computed({
      where: { line: 9, nth: 1 },
      question: () => 'The two pointers have not met yet. On a list with no cycle, what ends this loop?',
      answer: () => 'fast reaches the end of the list',
      options: (a) => [
        a,
        'slow catches up to fast',
        'They meet at the head',
        'Nothing — it runs forever',
      ],
      because:
        'Without a cycle there is an end, and fast gets there first because it moves twice as quickly — in about half as many rounds as the list is long. With a cycle there is no end, so the only way out is the two pointers meeting, which the closing gap guarantees they will.',
    }),
    {
      locate: (trace) => trace.steps.findIndex((s) => s.line === 9),
      question: () =>
        'On a list that really does loop, why are the two pointers guaranteed to land on the same node rather than stepping past each other?',
      options: () => [
        'The gap between them shrinks by exactly one each round, so it must hit zero',
        'The fast pointer eventually runs out of list',
        'They both start at the head, so they stay together',
        'The loop length is always even',
      ],
      answer: () => 'The gap between them shrinks by exactly one each round, so it must hit zero',
      because: () =>
        'Inside the loop, fast gains two nodes and slow gains one, so the distance between them falls by exactly one per round. A quantity that decreases by one at a time cannot jump over zero — which is why a collision is certain, not merely likely.',
    },
  ],
};
