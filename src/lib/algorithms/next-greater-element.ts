import { cell, ev } from '../trace/tracer';
import { Tracer } from '../trace/tracer';
import { computed, conceptual } from './checkpoints';
import { AlgorithmDef, RunFn } from './types';

const CPP = `vector<int> nextGreater(vector<int>& arr) {
    int n = arr.size();
    vector<int> ans(n, -1);
    stack<int> st;

    for (int i = 0; i < n; i++) {
        while (!st.empty() && arr[st.top()] < arr[i]) {
            ans[st.top()] = arr[i];
            st.pop();
        }

        st.push(i);
    }

    return ans;
}`;

const C = `void nextGreater(int arr[], int n, int ans[]) {
    int size = n;
    for (int k = 0; k < n; k++) ans[k] = -1;
    int st[256]; int top = -1;

    for (int i = 0; i < n; i++) {
        while (top >= 0 && arr[st[top]] < arr[i]) {
            ans[st[top]] = arr[i];
            top--;
        }

        st[++top] = i;
    }

    return;
}`;

const JAVA = `int[] nextGreater(int[] arr) {
    int n = arr.length;
    int[] ans = new int[n]; Arrays.fill(ans, -1);
    Deque<Integer> st = new ArrayDeque<>();

    for (int i = 0; i < n; i++) {
        while (!st.isEmpty() && arr[st.peek()] < arr[i]) {
            ans[st.peek()] = arr[i];
            st.pop();
        }

        st.push(i);
    }

    return ans;
}`;

/** The stack must stay monotonic, or the "first greater" claim is not true. */
function derive(t: Tracer, arr: number[], st: number[]) {
  if (!t.tracing) return;
  let ok = true;
  for (let k = 1; k < st.length; k++) {
    if (arr[st[k - 1]] < arr[st[k]]) ok = false;
  }
  t.derive({ stackMonotonic: ok, stackDepth: st.length });
}

interface Opts {
  /** The buggy pop condition resolves the wrong direction. */
  popWhenGreater: boolean;
  /** The buggy write stores the index instead of the value found. */
  storeIndex: boolean;
}

function makeRun(opts: Opts): RunFn {
  return (input, t) => {
    const arr = (input.array ?? []).slice();
    const n = arr.length;
    const ans: number[] = new Array(n).fill(-1);
    const st: number[] = [];

    t.array('arr', arr, 'arr');
    t.array('ans', ans, 'ans');
    t.seq('st', st, 'stack', 'st — indices still waiting');
    // `ans` is the answer, not working storage; the stack is the space cost.
    t.aux('st', () => st.length);
    t.enter('nextGreater', 'nextGreater(arr)');

    let i: number | null = null;
    let topIdx: number | null = null;

    derive(t, arr, st);
    t.step(2, { n, i, topIdx }, `${n} element${n === 1 ? '' : 's'}. For each one, find the first value to its right that is larger.`, ev.call('nextGreater', 'nextGreater(arr)'));
    t.step(3, { n, i, topIdx }, 'Every answer starts at -1, meaning "nothing larger was ever found".');
    t.step(4, { n, i, topIdx }, 'The stack holds indices whose answer is still unknown — never values, because the answer has to be written back to a position.');

    for (i = 0; i < n; i++) {
      t.tick();

      for (;;) {
        topIdx = st.length ? st[st.length - 1] : null;
        const nonEmpty = st.length > 0;
        const resolves =
          nonEmpty && (opts.popWhenGreater ? arr[topIdx!] > arr[i] : arr[topIdx!] < arr[i]);
        derive(t, arr, st);
        t.step(
          7,
          { n, i, topIdx },
          () =>
            !nonEmpty
              ? `The stack is empty — nothing is waiting on arr[${i}].`
              : `Top of stack is index ${topIdx}, holding ${arr[topIdx as number]}. Against arr[${i}] = ${arr[i as number]}: ${resolves ? 'this is the greater value it has been waiting for.' : 'not greater, so it keeps waiting.'}`,
          nonEmpty ? ev.cmp(cell('arr', topIdx as number), opts.popWhenGreater ? '>' : '<', cell('arr', i), resolves) : undefined,
        );
        if (!resolves) break;

        ans[topIdx!] = opts.storeIndex ? i : arr[i];
        t.step(8, { n, i, topIdx }, () => `Index ${topIdx} is answered: ${ans[topIdx as number]}.`, ev.write('ans', topIdx as number, ans[topIdx as number]));

        const popped = st.pop()!;
        derive(t, arr, st);
        t.step(9, { n, i, topIdx }, () => `Index ${popped} is done, so it leaves the stack. It can never need answering again.`, ev.pop('st', popped));
      }

      st.push(i);
      topIdx = i;
      derive(t, arr, st);
      t.step(12, { n, i, topIdx }, () => `Index ${i} has no answer yet, so it waits on the stack.`, ev.push('st', i as number));
    }

    t.derive({ stackMonotonic: null, stackDepth: null });
    // Self-checking: for each index, is the recorded answer really a later,
    // larger value — or -1 with no such value existing?
    t.derive({
      answersOk: ans.every((a, k) => {
        const later = arr.slice(k + 1).filter((v) => v > arr[k]);
        return a === -1 ? later.length === 0 : a === later[0];
      })
        ? 1
        : 0,
    });
    t.step(15, { n, i, topIdx }, () => `Anything still on the stack has no greater value anywhere to its right, so its answer stays -1. Result: [${ans.join(', ')}]`, ev.ret('nextGreater', ans.join(',')));
    t.exit();
    return ans.join(',');
  };
}

const run: RunFn = (input, t, mut) =>
  makeRun({
    popWhenGreater: mut.has('flipped'),
    storeIndex: mut.has('store-index'),
  })(input, t, mut);

export const nextGreaterElement: AlgorithmDef = {
  slug: 'next-greater-element',
  name: 'Next Greater Element',
  category: 'searching',
  tagline: 'For every value, find the first larger one to its right — in a single pass.',
  intuition: [
    'The obvious solution looks right from each element until it finds something bigger, which costs O(n²) on a descending array. The one-pass version replaces that searching with remembering.',
    'Walk left to right. Any element you pass whose answer you do not yet know goes on a stack. When a new value arrives, it is the answer for every waiting element it beats — and because they were pushed in order, those are exactly the ones sitting on top.',
    'That is why the stack stays monotonic: an element can only be waiting if nothing since has beaten it, so from bottom to top the values never increase. Each index is pushed once and popped once, which is what makes the whole thing linear despite the nested loop.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'arr',
    pointers: [
      { var: 'i', on: 'arr', role: 'cursor', label: 'i', hint: 'The value currently arriving.' },
      { var: 'topIdx', on: 'arr', role: 'probe', label: 'top', hint: 'The index on top of the stack, still waiting.' },
    ],
    regions: [
      { on: 'arr', kind: 'eliminated', from: 0, to: 'i - 1', label: 'already passed' },
      { on: 'arr', kind: 'considering', from: 'i', to: 'i', label: 'arriving now' },
    ],
    invariant: {
      text: 'Values at the stacked indices never increase from the bottom of the stack to the top.',
      check: 'stackMonotonic',
      when: 'defined(stackMonotonic)',
      why: 'If a smaller value sat below a larger one, the larger one would already have answered it and popped it. Keeping the stack monotonic is what guarantees the popping loop finds *every* element the new value answers, and stops at the first one it does not — without ever searching.',
    },
    postcondition: {
      text: 'Every answer is either -1, or a value that really does appear later and really is larger.',
      check: 'answersOk === 1',
      why: 'The stack invariant says the pending indices are in decreasing order, which is true of a run that stores completely the wrong thing in the answer array. This is the claim about the answers themselves, and it is self-checking: no oracle is needed, because "is this value later and larger" can be asked of the array directly.',
    },
  },
  run,
  defaultInput: { array: [4, 5, 2, 10, 8] },
  fields: [{ key: 'array', label: 'Array', kind: 'array', help: 'Try a strictly decreasing one — nothing ever pops.' }],
  // Strictly decreasing, which is the worst case for both cost and storage:
  // nothing is ever popped until the very end, so the stack grows to n. A
  // shuffled array measures the same time and a much smaller stack, which
  // would leave the stated space bound unsupported by its own measurement.
  makeInput: (n) => ({ array: Array.from({ length: n }, (_, k) => n - k) }),
  growthSizes: [64, 128, 256, 512, 1024, 2048, 4096, 8192],
  projectTo: 1_000_000,
  complexity: {
    time: 'O(n)',
    space: 'O(n) for the stack',
    note: 'The nested while loop looks quadratic, but each index is pushed exactly once and popped at most once, so the inner loop runs at most n times over the entire outer loop. This is amortised analysis: the cost of a single step can be large, the total cannot.',
  },
  userLane: {
    fnName: 'nextGreater',
    starters: {
      cpp: `vector<int> nextGreater(vector<int>& arr) {
    int n = arr.size();
    vector<int> ans(n, -1);
    stack<int> st;

    for (int i = 0; i < n; i++) {
        while (!st.empty() && arr[st.top()] < arr[i]) {
            ans[st.top()] = arr[i];
            st.pop();
        }
        st.push(i);
    }
    return ans;
}`,
      c: `int* nextGreater(int arr[], int n) {
    int ans[n];
    int st[n];
    int top = -1;

    for (int i = 0; i < n; i++) ans[i] = -1;

    for (int i = 0; i < n; i++) {
        while (top >= 0 && arr[st[top]] < arr[i]) {
            ans[st[top]] = arr[i];
            top--;
        }
        top++;
        st[top] = i;
    }
    return ans;
}`,
      java: `int[] nextGreater(int[] arr) {
    int n = arr.length;
    int[] ans = new int[n];
    int[] st = new int[n];
    int top = -1;

    for (int i = 0; i < n; i++) ans[i] = -1;

    for (int i = 0; i < n; i++) {
        while (top >= 0 && arr[st[top]] < arr[i]) {
            ans[st[top]] = arr[i];
            top--;
        }
        top++;
        st[top] = i;
    }
    return ans;
}`,
      js: `function nextGreater(arr) {
  let n = arr.length;
  let ans = [];
  let st = [];

  for (let i = 0; i < n; i++) {
    ans.push(-1);
  }

  for (let i = 0; i < n; i++) {
    while (st.length > 0 && arr[st[st.length - 1]] < arr[i]) {
      ans[st[st.length - 1]] = arr[i];
      st.pop();
    }
    st.push(i);
  }
  return ans.join(',');
}`,
    },
    compareBy: 'return',
  },
  mutations: [
    {
      id: 'flipped',
      edits: [
        { line: 7, from: 'arr[st.top()] < arr[i]', to: 'arr[st.top()] > arr[i]', langs: ['cpp'] },
        { line: 7, from: 'arr[st[top]] < arr[i]', to: 'arr[st[top]] > arr[i]', langs: ['c'] },
        { line: 7, from: 'arr[st.peek()] < arr[i]', to: 'arr[st.peek()] > arr[i]', langs: ['java'] },
      ],
      label: 'pop on smaller',
      note: 'Turns the stack around: each element is answered with the next smaller value instead.',
    },
    {
      id: 'store-index',
      edits: [
        { line: 8, from: 'ans[st.top()] = arr[i];', to: 'ans[st.top()] = i;', langs: ['cpp'] },
        { line: 8, from: 'ans[st[top]] = arr[i];', to: 'ans[st[top]] = i;', langs: ['c'] },
        { line: 8, from: 'ans[st.peek()] = arr[i];', to: 'ans[st.peek()] = i;', langs: ['java'] },
      ],
      label: 'store the index',
      note: 'Writes a position where a value belongs — both are ints, so nothing complains.',
    },
  ],
  variants: [
    {
      id: 'flipped',
      label: 'arr[st.top()] > arr[i]',
      blurb: 'Answers elements with values that are smaller, not greater.',
      explanation:
        'The comparison decides what the stack means. With > the stack accumulates increasing values and pops whenever a smaller one arrives, so each element is answered with the next *smaller* element instead. Everything else about the algorithm is unchanged — which is why this pattern solves next-smaller, previous-greater and several other problems purely by rewriting this one line.',
      mutations: ['flipped'],
    },
    {
      id: 'store-index',
      label: 'ans[st.top()] = i',
      blurb: 'Fills the answer array with positions instead of values.',
      explanation:
        'The stack holds indices and the answer array holds values, and this line quietly mixes the two. It is an easy slip precisely because both are ints: the compiler cannot tell you that one of these numbers is a position and the other is a measurement.',
      mutations: ['store-index'],
    },
  ],
  edgeCases: [
    { id: 'mixed', label: 'Mixed', input: { array: [4, 5, 2, 10, 8] }, why: 'The usual case. Watch 2 wait on the stack until 10 arrives and answers it.' },
    { id: 'decreasing', label: 'Strictly decreasing', input: { array: [5, 4, 3, 2, 1] }, why: 'Nothing is ever greater, so nothing ever pops. The stack grows to n and every answer stays -1.' },
    { id: 'increasing', label: 'Strictly increasing', input: { array: [1, 2, 3, 4, 5] }, why: 'Every arrival answers the one before it, so the stack never holds more than one index.' },
    { id: 'dupes', label: 'All equal', input: { array: [7, 7, 7, 7] }, why: 'Strict < means equal values do not answer each other — "greater" has to mean strictly greater.' },
    { id: 'one-peak', label: 'One large value at the end', input: { array: [3, 1, 2, 9] }, why: 'The final value clears the entire stack in one go. This is the step where the inner loop does all its work at once.' },
    { id: 'single', label: 'One element', input: { array: [5] }, why: 'Pushed, never popped, answer -1.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 12 },
      question: 'An index is pushed onto the stack. What is true of every index already on it?',
      options: [
        'Their values are all larger than this one',
        'Their values are all smaller than this one',
        'They are in no particular order',
        'They have all been answered already',
      ],
      answer: 'Their values are all larger than this one',
      because:
        'Anything smaller was popped by the loop just above, precisely because this value answered it. So the stack is always decreasing from bottom to top — and that ordering is the whole trick: it means the answer for a popped index is always the value currently being looked at, with no searching required.',
    }),
    conceptual({
      where: { line: 7, nth: 2 },
      question: 'The inner while loop can run many times in one iteration. Why is the whole algorithm still linear?',
      options: [
        'Each index is pushed once and popped once, so pops total at most n',
        'The inner loop runs at most twice per element',
        'The stack never holds more than a constant number of indices',
        'The array is assumed to be sorted',
      ],
      answer: 'Each index is pushed once and popped once, so pops total at most n',
      because:
        'Counting the worst case of the inner loop and multiplying gives n², and that answer is wrong. The right question is how many pops can ever happen in total, and the answer is n, because nothing is pushed twice. This is amortised analysis, and it is the reason a nested loop is not automatically quadratic.',
    }),
    computed({
      where: { line: 12, nth: -1 },
      question: (step) => {
        const st = step.structs.st;
        const size = st && st.kind === 'seq' ? st.values.length : 0;
        return `The scan has finished and ${size} index${size === 1 ? '' : 'es'} remain on the stack. What is the answer for those?`;
      },
      answer: () => '-1 — nothing to their right is larger',
      options: (a) => [a, '0', 'The last element', 'They are still unanswered'],
      because:
        'An index leaves the stack only when something larger appears. Anything still on it when the array runs out never met such a value, so its answer is that there is none. The leftovers are not an edge case to handle separately — they are the answer, already computed by nothing having happened to them.',
    }),
    {
      locate: (trace) => trace.steps.findIndex((s) => s.line === 9),
      question: () =>
        'The inner loop is nested inside the outer one. Why is the total work still O(n) rather than O(n²)?',
      options: () => [
        'Each index is pushed once and popped once, so pops total at most n',
        'The inner loop runs at most twice per element',
        'The stack never holds more than a constant number of indices',
        'The array is assumed to be sorted',
      ],
      answer: () => 'Each index is pushed once and popped once, so pops total at most n',
      because: () =>
        'A single arrival can pop many indices, so no per-step bound exists — but every pop consumes a push that already happened, and there are only n pushes in total. Counting the work across the whole run rather than per step is what amortised analysis means.',
    },
  ],
};
