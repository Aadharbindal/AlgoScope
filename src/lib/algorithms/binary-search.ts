import { cell, ev, vr } from '../trace/tracer';
import { computed, conceptual, num } from './checkpoints';
import { AlgorithmDef, Input, RunFn } from './types';

const CPP = `int binarySearch(vector<int>& arr, int target) {
    int low = 0;
    int high = arr.size() - 1;

    while (low <= high) {
        int mid = low + (high - low) / 2;

        if (arr[mid] == target)
            return mid;

        if (arr[mid] < target)
            low = mid + 1;
        else
            high = mid - 1;
    }

    return -1;
}`;

const C = `int binarySearch(int arr[], int n, int target) {
    int low = 0;
    int high = n - 1;

    while (low <= high) {
        int mid = low + (high - low) / 2;

        if (arr[mid] == target)
            return mid;

        if (arr[mid] < target)
            low = mid + 1;
        else
            high = mid - 1;
    }

    return -1;
}`;

const JAVA = `int binarySearch(int[] arr, int target) {
    int low = 0;
    int high = arr.length - 1;

    while (low <= high) {
        int mid = low + (high - low) / 2;

        if (arr[mid] == target)
            return mid;

        if (arr[mid] < target)
            low = mid + 1;
        else
            high = mid - 1;
    }

    return -1;
}`;

interface Opts {
  /** The buggy loop stops while a one-element window is still unexamined. */
  strictLess: boolean;
  /** The buggy branch leaves mid inside the window, so it can stop shrinking. */
  lowKeepsMid: boolean;
}

function makeRun(opts: Opts): RunFn {
  return (input, t) => {
    const arr = (input.array ?? []).slice();
    const target = Number(input.target ?? 0);

    t.array('arr', arr, 'arr');
    t.oracle({ answer: arr.indexOf(target), target });
    t.enter('binarySearch', `binarySearch(arr, ${target})`);

    let low: number | null = null;
    let high: number | null = null;
    let mid: number | null = null;

    t.step(1, { low, high, mid, target }, 'Called with a sorted array and a target value.', ev.call('binarySearch', `binarySearch(arr, ${target})`));

    low = 0;
    t.step(2, { low, high, mid, target }, 'low starts at index 0 — the first element still in play.');

    high = arr.length - 1;
    t.step(
      3,
      { low, high, mid, target },
      () =>
        arr.length === 0
          ? 'The array is empty, so high starts at -1 and the window is already empty.'
          : `high starts at index ${high} — the last element still in play. The live window is the whole array.`,
    );

    // The width of the window when the previous round began. A round that does
    // not reduce it is a round that has made no progress, and a search that
    // makes no progress does not finish — which is a different failure from
    // returning the wrong answer, and needs its own claim.
    let previousWidth = Number.POSITIVE_INFINITY;

    /**
     * How many rounds a halving search is allowed on this array.
     *
     * Published rather than written into the claim, because it is a fact about
     * the input that the claim then holds the algorithm to: a window that
     * really does at least halve each round cannot survive more rounds than it
     * takes to halve n down to nothing.
     */
    let rounds = 0;
    const allowed = arr.length === 0 ? 0 : Math.floor(Math.log2(arr.length)) + 1;

    for (;;) {
      const width = (high as number) - (low as number) + 1;
      t.derive({ shrinking: width < previousWidth ? 1 : 0, rounds, allowed });
      previousWidth = width;

      const keepGoing = opts.strictLess ? low < high : low <= high;
      t.step(
        5,
        { low, high, mid, target },
        () =>
          keepGoing
            ? `The window [${low}, ${high}] still holds ${(high as number) - (low as number) + 1} element${(high as number) - (low as number) === 0 ? '' : 's'}. Keep searching.`
            : opts.strictLess && low === high
              ? `low and high have met at ${low}. This loop stops here — even though that single element has never been compared.`
              : `low is ${low} and high is ${high}, so the window is empty. There is nowhere left for ${target} to hide.`,
        ev.cmp(vr('low'), opts.strictLess ? '<' : '<=', vr('high'), keepGoing),
      );
      if (!keepGoing) break;
      rounds++;
      t.tick();

      mid = low + Math.floor((high - low) / 2);
      t.step(
        6,
        { low, high, mid, target },
        () =>
          `mid = ${mid}, the middle of the live window. Written as low + (high - low) / 2 rather than (low + high) / 2 so the addition can never overflow.`,
      );

      const isEqual = arr[mid] === target;
      t.step(
        8,
        { low, high, mid, target },
        () => `arr[${mid}] is ${arr[mid as number]}. Is that equal to ${target}? ${isEqual ? 'Yes.' : 'No.'}`,
        ev.cmp(cell('arr', mid), '==', vr('target'), isEqual),
      );

      if (isEqual) {
        // The promise made to the caller, judged where the answer exists.
        t.derive({ found: arr[mid as number] === target ? 1 : 0, rounds, allowed });
        t.step(9, { low, high, mid, target }, () => `Found ${target} at index ${mid}. Returning that index.`, ev.found('arr', mid as number));
        t.exit();
        return mid;
      }

      const isLess = arr[mid] < target;
      t.step(
        11,
        { low, high, mid, target },
        () =>
          `arr[${mid}] is ${arr[mid as number]}, which is ${isLess ? 'smaller' : 'larger'} than ${target}. Because the array is sorted, that rules out one whole half.`,
        ev.cmp(cell('arr', mid), '<', vr('target'), isLess),
      );

      if (isLess) {
        const oldLow = low;
        low = opts.lowKeepsMid ? mid : mid + 1;
        const removed = low - oldLow;
        t.step(
          12,
          { low, high, mid, target },
          () =>
            opts.lowKeepsMid
              ? `low moves to ${low} — but mid is still inside the window, so nothing has been ruled out beyond arr[${oldLow}..${(low as number) - 1}].`
              : `Indices ${oldLow}–${mid} all hold values ≤ ${arr[mid as number]} < ${target}, so ${removed} element${removed === 1 ? '' : 's'} ${removed === 1 ? 'is' : 'are'} eliminated. low moves to ${low}.`,
        );
      } else {
        const removed = high - mid + 1;
        const oldHigh = high;
        high = mid - 1;
        t.step(
          14,
          { low, high, mid, target },
          () =>
            `Indices ${mid}–${oldHigh} all hold values ≥ ${arr[mid as number]} > ${target}, so ${removed} element${removed === 1 ? '' : 's'} ${removed === 1 ? 'is' : 'are'} eliminated. high moves to ${high}.`,
        );
      }
    }

    t.derive({ found: arr.indexOf(target) === -1 ? 1 : 0, rounds, allowed });
    t.step(17, { low, high, mid, target }, () => `${target} is not in this array. Returning -1.`, ev.fail('search space exhausted'));
    t.exit();
    return -1;
  };
}

const run: RunFn = (input, t, mut) =>
  makeRun({
    strictLess: mut.has('strict-less'),
    lowKeepsMid: mut.has('no-progress'),
  })(input, t, mut);

/* ------------------------------- definition ------------------------------- */

const isSorted = (a: number[]) => a.every((v, i) => i === 0 || a[i - 1] <= v);

export const binarySearch: AlgorithmDef = {
  slug: 'binary-search',
  name: 'Binary Search',
  category: 'searching',
  tagline: 'Halve the search space until nothing is left to check.',
  intuition: [
    'You are looking for a name in a phone book. You do not start at page one — you open the middle, see which half the name must be in, and throw the other half away. Then you do it again.',
    'Every comparison you make must let you discard something. That is the whole idea, and it is why the array has to be sorted: sortedness is the proof that everything on one side of the middle can be ruled out without looking at it.',
    'The two variables low and high are not really numbers. They are a claim: "if the target exists at all, it is somewhere between these two indices." Watch that claim narrow.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'arr',
    pointers: [
      { var: 'low', on: 'arr', role: 'window-start', label: 'low', hint: 'First index still in play.' },
      { var: 'high', on: 'arr', role: 'window-end', label: 'high', hint: 'Last index still in play.' },
      { var: 'mid', on: 'arr', role: 'probe', label: 'mid', hint: 'The element being tested this round.' },
    ],
    regions: [
      { on: 'arr', kind: 'eliminated', from: 0, to: 'low - 1', label: 'ruled out — too small' },
      { on: 'arr', kind: 'eliminated', from: 'high + 1', to: 'n - 1', label: 'ruled out — too large' },
      { on: 'arr', kind: 'active', from: 'low', to: 'high', label: 'still in play' },
    ],
    invariant: {
      text: 'The target, if present, is inside [low, high] — and the window is strictly smaller than it was.',
      check: '(answer === -1 || (answer >= low && answer <= high)) && shrinking === 1',
      when: 'defined(low) && defined(high) && defined(shrinking)',
      why: 'Two promises, and binary search needs both. Containment is what earns the right to throw away half the array: the half being discarded provably cannot hold the target. Progress is what earns the right to loop at all — each round must leave a strictly smaller window, or the search never ends. Stating only the first is a mistake worth seeing: a version that sets low = mid keeps the target inside the window forever while never finishing, and a containment-only invariant reports that everything is fine.',
    },
    postcondition: {
      text: 'The index returned really holds the target — or it is -1 and the target really is absent.',
      check: 'found === 1',
      why: 'The invariant above tracks the window while the search runs and says nothing about when the loop is allowed to stop. A version that ends one round early keeps the target inside the window for the entire run — the invariant is satisfied at every single step — and then returns -1 for a value that was sitting right there. Correct along the way and correct at the end are two different claims, and this is the second.',
    },
    cost: {
      text: 'The window at least halves every round, so the search never takes more rounds than halving n down to nothing.',
      check: 'rounds <= allowed',
      why: 'This is the only reason to prefer binary search over walking the array, and it is the one thing the answer cannot show you — both return the same index. The claim is not "it was fast"; it is that every round threw away half of what was left. A version whose window shrinks by one instead of by half still finds the target, still keeps its invariant, and is linear search wearing a midpoint.',
    },
  },
  run,
  defaultInput: { array: [2, 5, 8, 12, 16, 23, 38, 45, 56], target: 38 },
  fields: [
    { key: 'array', label: 'Sorted array', kind: 'array', help: 'Values must be in non-decreasing order.' },
    { key: 'target', label: 'Target', kind: 'number' },
  ],
  validate: (input: Input) => {
    const a = input.array ?? [];
    if (!isSorted(a)) {
      return 'Binary search assumes a sorted array. Unsorted input will make it discard the half the target is actually in — try it and watch the invariant break.';
    }
    return null;
  },
  makeInput: (n) => ({
    array: Array.from({ length: n }, (_, i) => i * 2),
    target: n * 2 + 1,
  }),
  growthSizes: [64, 256, 1024, 4096, 16384, 65536, 262144, 1048576],
  projectTo: 1_000_000,
  complexity: {
    time: 'O(log n)',
    space: 'O(1)',
    note: 'Each iteration throws away half of what is left, so the number of iterations is the number of times n can be halved before reaching 1.',
  },
  userLane: {
    fnName: 'binarySearch',
    starters: {
      cpp: `int binarySearch(vector<int>& arr, int target) {
    int low = 0;
    int high = arr.size() - 1;

    while (low <= high) {
        int mid = low + (high - low) / 2;

        if (arr[mid] == target) return mid;

        if (arr[mid] < target) {
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return -1;
}`,
      c: `int binarySearch(int arr[], int n, int target) {
    int low = 0;
    int high = n - 1;

    while (low <= high) {
        int mid = low + (high - low) / 2;

        if (arr[mid] == target) return mid;

        if (arr[mid] < target) {
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return -1;
}`,
      java: `int binarySearch(int[] arr, int target) {
    int low = 0;
    int high = arr.length - 1;

    while (low <= high) {
        int mid = low + (high - low) / 2;

        if (arr[mid] == target) return mid;

        if (arr[mid] < target) {
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return -1;
}`,
      js: `function binarySearch(arr, target) {
  let low = 0;
  let high = arr.length - 1;

  while (low <= high) {
    let mid = low + Math.floor((high - low) / 2);

    if (arr[mid] === target) return mid;

    if (arr[mid] < target) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return -1;
}`,
    },
    compareBy: 'return',
  },
  mutations: [
    {
      id: 'strict-less',
      edits: [{ line: 5, from: 'while (low <= high)', to: 'while (low < high)' }],
      label: 'while (low < high)',
      note: 'Stops while a one-element window is still unexamined.',
    },
    {
      id: 'no-progress',
      edits: [{ line: 12, from: 'low = mid + 1;', to: 'low = mid;' }],
      label: 'low = mid',
      note: 'Leaves mid inside the window, so a two-element window can stop shrinking.',
    },
  ],
  variants: [
    {
      id: 'strict-less',
      label: 'while (low < high)',
      blurb: 'Finds most targets, but sometimes reports "not found" for a value that is definitely there.',
      explanation:
        'When the window narrows to a single element, low equals high. With `<` that iteration never runs, so the last remaining candidate is never compared against the target. The window was not empty — the loop just refused to look at it.',
      mutations: ['strict-less'],
    },
    {
      id: 'no-progress',
      label: 'low = mid',
      blurb: 'Hangs on some inputs instead of returning.',
      explanation:
        'Setting low = mid leaves mid inside the window. Once the window is two elements wide, mid rounds down to low, so low never moves and the window stops shrinking. The loop condition stays true forever. Every binary search needs each branch to strictly exclude mid.',
      mutations: ['no-progress'],
    },
  ],
  edgeCases: [
    { id: 'empty', label: 'Empty array', input: { array: [], target: 5 }, why: 'high starts at -1, so the loop body never runs. Does your code survive that?' },
    { id: 'single-hit', label: 'One element, present', input: { array: [7], target: 7 }, why: 'The window is a single index. This is the case a `<` instead of `<=` silently drops.' },
    { id: 'single-miss', label: 'One element, absent', input: { array: [7], target: 3 }, why: 'high must become -1 for the loop to end.' },
    { id: 'first', label: 'Target is first', input: { array: [2, 5, 8, 12, 16, 23, 38, 45, 56], target: 2 }, why: 'Best case for position, but still log n comparisons — binary search cannot get lucky early the way linear search can.' },
    { id: 'last', label: 'Target is last', input: { array: [2, 5, 8, 12, 16, 23, 38, 45, 56], target: 56 }, why: 'Drives low upward on every step.' },
    { id: 'absent', label: 'Target absent', input: { array: [2, 5, 8, 12, 16, 23, 38, 45, 56], target: 40 }, why: 'The window shrinks to nothing. This is the true worst case.' },
    { id: 'dupes', label: 'Duplicates', input: { array: [1, 3, 3, 3, 3, 3, 9], target: 3 }, why: 'Returns *a* match, not the first one. If you need the first, you need a different loop.' },
    { id: 'unsorted', label: 'Unsorted input', input: { array: [9, 2, 45, 8, 16, 5, 38], target: 38 }, why: 'The precondition is violated. Watch the invariant break and the algorithm discard the half containing the answer.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 6 },
      question: 'Why is mid written as low + (high - low) / 2 rather than (low + high) / 2?',
      options: [
        'Because low + high can overflow a 32-bit int',
        'Because it rounds differently',
        'Because it is faster',
        'They are identical — it is a matter of style',
      ],
      answer: 'Because low + high can overflow a 32-bit int',
      because:
        'On an array big enough, low + high exceeds what an int can hold and wraps negative, so mid lands outside the array. The two forms are mathematically equal and are not equal in a fixed-width integer type. Write this one in C++, C or Java on the "Your code" tab and the interpreter will show you the wrap.',
    }),
    computed({
      where: { line: 12 },
      question: (step) => `low is about to move past mid = ${step.vars.mid}. How many elements does that rule out in one step?`,
      answer: (step) => String(num(step, 'mid') - num(step, 'low') + 1),
      options: (a, step) => [a, '1', String(num(step, 'mid')), String(num(step, 'n'))],
      because:
        'Everything from low up to and including mid is discarded at once, because the array being sorted proves none of it can hold the target. Ruling out a block rather than an element is the entire difference between this and a linear scan — and it is only permitted by an assumption about the input.',
    }),
    conceptual({
      where: { line: 5, nth: -1 },
      question: 'The loop has just ended without finding the target. What does that prove?',
      options: [
        'The target is not in the array',
        'The target is not in the last window checked',
        'The array was not sorted',
        'Nothing — the search may have missed it',
      ],
      answer: 'The target is not in the array',
      because:
        'Each round discards a half only after proving the target cannot be there, so when the window finally empties, every index has been ruled out by an actual comparison. That chain of proofs is what the invariant tracks. Break one link — a branch that keeps mid, a loop that stops one round early — and the conclusion stops following.',
    }),
    {
      locate: (trace) => trace.steps.findIndex((s) => s.line === 12 || s.line === 14),
      question: (trace, at) => {
        const before = trace.steps[at - 1];
        return `The window is [${before.vars.low}, ${before.vars.high}] and mid is ${before.vars.mid}. The next line runs. What is the window afterwards?`;
      },
      options: (trace, at) => {
        const b = trace.steps[at - 1].vars;
        const a = trace.steps[at].vars;
        const fmt = (lo: unknown, hi: unknown) => `[${lo}, ${hi}]`;
        const set = new Set<string>([
          fmt(a.low, a.high),
          fmt(b.mid, b.high),
          fmt(b.low, b.mid),
          fmt(b.low, b.high),
        ]);
        return [...set].slice(0, 4).sort();
      },
      answer: (trace, at) => `[${trace.steps[at].vars.low}, ${trace.steps[at].vars.high}]`,
      because: (trace, at) => trace.steps[at].narration,
    },
    {
      locate: (trace) => {
        const first = trace.steps.findIndex((s) => s.line === 12 || s.line === 14);
        if (first < 0) return -1;
        return trace.steps.findIndex((s, i) => i > first && s.line === 5);
      },
      question: () => 'How many elements are still in play right now?',
      options: (trace, at) => {
        const v = trace.steps[at].vars;
        const lo = Number(v.low);
        const hi = Number(v.high);
        const correct = Math.max(0, hi - lo + 1);
        const set = new Set<number>([correct, correct + 1, Math.max(0, correct - 1), correct * 2]);
        return [...set].slice(0, 4).sort((x, y) => x - y).map(String);
      },
      answer: (trace, at) => {
        const v = trace.steps[at].vars;
        return String(Math.max(0, Number(v.high) - Number(v.low) + 1));
      },
      because: () =>
        'The live window is inclusive on both ends, so it holds high − low + 1 elements. Off-by-one errors in binary search almost always come from getting this count wrong.',
    },
  ],
};
