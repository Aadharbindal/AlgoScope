import { cell, ev, vr } from '../trace/tracer';
import { computed, conceptual, num } from './checkpoints';
import { AlgorithmDef, RunFn } from './types';

const CPP = `int linearSearch(vector<int>& arr, int target) {
    for (int i = 0; i < arr.size(); i++) {
        if (arr[i] == target)
            return i;
    }

    return -1;
}`;

const C = `int linearSearch(int arr[], int n, int target) {
    for (int i = 0; i < n; i++) {
        if (arr[i] == target)
            return i;
    }

    return -1;
}`;

const JAVA = `int linearSearch(int[] arr, int target) {
    for (int i = 0; i < arr.length; i++) {
        if (arr[i] == target)
            return i;
    }

    return -1;
}`;

interface Opts {
  start: number;
  /** The buggy bound walks one index past the last element. */
  overrun: boolean;
}

function makeRun(opts: Opts): RunFn {
  return (input, t) => {
    const arr = (input.array ?? []).slice();
    const target = Number(input.target ?? 0);
    const n = arr.length;

    t.array('arr', arr, 'arr');
    t.oracle({ answer: arr.indexOf(target), target });
    t.enter('linearSearch', `linearSearch(arr, ${target})`);

    let i: number | null = null;
    t.step(1, { i, n, target }, `Walk the array from the front, comparing each value with ${target}.`, ev.call('linearSearch', `linearSearch(arr, ${target})`));

    const limit = opts.overrun ? n + 1 : n;
    for (i = opts.start; ; i++) {
      const keepGoing = i < limit;
      t.step(
        2,
        { i, n, target },
        () =>
          keepGoing
            ? `i = ${i}, still inside the array, so there is another value to check.`
            : `i = ${i} has reached the end. Every element has been compared.`,
        ev.cmp(vr('i'), '<', vr('n'), keepGoing),
      );
      if (!keepGoing) break;
      t.tick();

      const here = arr[i];
      const isMatch = here === target;
      t.step(
        3,
        { i, n, target },
        () =>
          here === undefined
            ? `Reading arr[${i}] — one past the last index of a ${n}-element array. In C++ that is undefined behaviour.`
            : `arr[${i}] is ${here}. Is it ${target}? ${isMatch ? 'Yes.' : 'No — move on.'}`,
        ev.cmp(cell('arr', i), '==', vr('target'), isMatch),
      );

      if (isMatch) {
        // The promise made to the caller, judged where the answer exists.
        t.derive({ found: arr[i as number] === target ? 1 : 0 });
        t.step(4, { i, n, target }, () => `Found ${target} at index ${i}. Returning immediately — there is no reason to look at the rest.`, ev.found('arr', i as number));
        t.exit();
        return i;
      }
    }

    t.derive({ found: arr.indexOf(target) === -1 ? 1 : 0 });
    t.step(7, { i, n, target }, () => `${target} never matched any element. Returning -1.`, ev.fail('every element compared'));
    t.exit();
    return -1;
  };
}

/** Mutations compose: both may be switched on at once. */
const run: RunFn = (input, t, mut) =>
  makeRun({
    start: mut.has('skip-first') ? 1 : 0,
    overrun: mut.has('overrun'),
  })(input, t, mut);

export const linearSearch: AlgorithmDef = {
  slug: 'linear-search',
  name: 'Linear Search',
  category: 'searching',
  tagline: 'Check every element in turn until you find the one you want.',
  intuition: [
    'The simplest possible search: start at the front and look at each value until one matches. No assumptions, no preparation, no sorting required.',
    'That last part is the whole reason it still matters. Binary search is far faster, but it demands a sorted array. Linear search demands nothing at all, which makes it the only option on unsorted data and the right option on tiny arrays.',
    'Watch the counter rather than the picture. The interesting thing here is not what the algorithm does — it is how the number of comparisons tracks exactly where the target happens to sit.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'arr',
    pointers: [{ var: 'i', on: 'arr', role: 'cursor', label: 'i', hint: 'The element being compared right now.' }],
    regions: [
      { on: 'arr', kind: 'eliminated', from: 0, to: 'i - 1', label: 'already checked' },
      { on: 'arr', kind: 'active', from: 'i', to: 'n - 1', label: 'not yet checked' },
    ],
    invariant: {
      text: 'The target is not anywhere in arr[0 .. i-1].',
      check: 'answer === -1 || answer >= i',
      when: 'defined(i)',
      why: 'This is the only promise linear search makes, and it is what lets it return the moment it finds a match: everything behind the cursor has already been ruled out by an explicit comparison. Skip an index and the promise becomes a lie.',
    },
    postcondition: {
      text: 'The index returned really holds the target — or it is -1 and the target really is absent.',
      check: 'found === 1',
      why: 'The same promise binary search makes, and the reason both belong on this site: the two algorithms are interchangeable to a caller precisely because they promise the same thing. They differ only in what they assume and what they cost.',
    },
    cost: {
      text: 'The loop looks at each element at most once — it never runs more times than the array is long.',
      check: 'ops_iterations <= n',
      why: 'Both claims above are about what is known and what is returned, and a loop whose bound reaches one past the end satisfies them completely: the target still is not in the part behind the cursor, and the answer still comes back right. What went wrong is that it read a cell that is not there, and the only evidence of that is the count. This is the smallest example of a whole class — work done that no one asked for, invisible in the result.',
    },
  },
  run,
  defaultInput: { array: [7, 3, 9, 2, 8, 5], target: 8 },
  fields: [
    { key: 'array', label: 'Array', kind: 'array', help: 'Any order — sorting is not required.' },
    { key: 'target', label: 'Target', kind: 'number' },
  ],
  makeInput: (n) => ({
    array: Array.from({ length: n }, (_, i) => i + 1),
    target: -1,
  }),
  growthSizes: [16, 32, 64, 128, 256, 512, 1024, 2048],
  projectTo: 1_000_000,
  complexity: {
    time: 'O(n) worst and average, O(1) best',
    space: 'O(1)',
    note: 'One comparison per element, stopping the instant it matches. The best case is a target sitting at index 0; the worst is a target that is absent, which forces every comparison.',
  },
  userLane: {
    fnName: 'linearSearch',
    starters: {
      cpp: `int linearSearch(vector<int>& arr, int target) {
    for (int i = 0; i < arr.size(); i++) {
        if (arr[i] == target) {
            return i;
        }
    }
    return -1;
}`,
      c: `int linearSearch(int arr[], int n, int target) {
    for (int i = 0; i < n; i++) {
        if (arr[i] == target) {
            return i;
        }
    }
    return -1;
}`,
      java: `int linearSearch(int[] arr, int target) {
    for (int i = 0; i < arr.length; i++) {
        if (arr[i] == target) {
            return i;
        }
    }
    return -1;
}`,
      js: `function linearSearch(arr, target) {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === target) {
      return i;
    }
  }
  return -1;
}`,
    },
    compareBy: 'return',
  },
  mutations: [
    {
      id: 'skip-first',
      edits: [{ line: 2, from: 'int i = 0;', to: 'int i = 1;' }],
      label: 'start at 1',
      note: 'Skips index 0 entirely — the first element is never compared.',
    },
    {
      id: 'overrun',
      edits: [
        { line: 2, from: 'i < arr.size();', to: 'i <= arr.size();', langs: ['cpp'] },
        { line: 2, from: 'i < n;', to: 'i <= n;', langs: ['c'] },
        { line: 2, from: 'i < arr.length;', to: 'i <= arr.length;', langs: ['java'] },
      ],
      label: 'i <= size()',
      note: 'Reads one position past the last element on the final iteration.',
    },
  ],
  variants: [
    {
      id: 'skip-first',
      label: 'i starts at 1',
      blurb: 'Finds most targets, but misses one specific case entirely.',
      explanation:
        'Array indices start at 0, so beginning the loop at 1 never compares the first element. Every other target is still found, which is exactly what lets this survive testing — until someone searches for the value at index 0.',
      mutations: ['skip-first'],
    },
    {
      id: 'overrun',
      label: 'i <= arr.size()',
      blurb: 'Returns the right answer, but touches memory it does not own.',
      explanation:
        'The last valid index is size() - 1, so this bound reads arr[size()] on the final iteration. Here that read simply yields nothing and the answer is unaffected; in C++ it is undefined behaviour that will pass every test you write and fail somewhere else entirely. The extra step in i is the only visible trace of it.',
      mutations: ['overrun'],
    },
  ],
  edgeCases: [
    { id: 'first', label: 'Target is first', input: { array: [7, 3, 9, 2, 8, 5], target: 7 }, why: 'The best case — one comparison. This is the case a loop starting at 1 silently drops.' },
    { id: 'last', label: 'Target is last', input: { array: [7, 3, 9, 2, 8, 5], target: 5 }, why: 'Every element is compared before the match.' },
    { id: 'absent', label: 'Target absent', input: { array: [7, 3, 9, 2, 8, 5], target: 4 }, why: 'The true worst case: n comparisons and nothing to show for them.' },
    { id: 'dupes', label: 'Duplicates', input: { array: [4, 1, 4, 4, 9], target: 4 }, why: 'Returns the first match and stops. If you need the last one, you cannot return early.' },
    { id: 'single', label: 'One element', input: { array: [5], target: 5 }, why: 'The loop body runs exactly once.' },
    { id: 'empty', label: 'Empty array', input: { array: [], target: 5 }, why: 'The loop never runs and -1 is the correct answer.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 2 },
      question: 'Before the first comparison has happened, what does this algorithm know about the array?',
      options: [
        'Nothing at all',
        'That it is sorted',
        'That the target is in it somewhere',
        'That the target is not at index 0',
      ],
      answer: 'Nothing at all',
      because:
        'This is the whole reason linear search still matters. It assumes nothing — not order, not uniqueness, not that the target is present — which is exactly why it cannot do better than looking at everything, and exactly why it is the only option when nothing has been established about the data.',
    }),
    computed({
      where: { line: 3, nth: -1 },
      question: (step) => `The loop has just made its last comparison, at index ${step.vars.i}. How many comparisons has it made in total?`,
      answer: (step) => String(num(step, 'i') + 1),
      options: (a, step) => [a, String(num(step, 'i')), String(num(step, 'n')), '1'],
      because:
        'One comparison per index, starting at 0 — so reaching index i means i + 1 comparisons have happened. That one-to-one rate between work and elements ruled out is the definition of linear time, and it is why the cost depends entirely on where the target happens to sit.',
    }),
    conceptual({
      where: { line: 2, nth: 1 },
      question: 'If the array were sorted, could this loop stop early when it passes a value larger than the target?',
      options: [
        'Yes, but only because sorting would let it — this code cannot',
        'Yes, and this code already does',
        'No, sorting does not help a linear scan',
        'No, it would give the wrong answer',
      ],
      answer: 'Yes, but only because sorting would let it — this code cannot',
      because:
        'A sorted array does allow an early exit, and doing so is a real improvement — but nothing in this loop knows the array is sorted, so it keeps going. That is the shape of almost every algorithmic speed-up: not a cleverer loop, but an assumption about the data that the code is finally allowed to use. Binary search is the same trade taken much further.',
    }),
    {
      locate: (trace) => trace.steps.findIndex((s) => s.line === 3),
      question: (trace, at) => {
        const v = trace.steps[at].vars;
        return `Suppose arr[${v.i}] does not match. How many elements will have been ruled out once this comparison finishes?`;
      },
      options: (trace, at) => {
        const i = Number(trace.steps[at].vars.i);
        return [...new Set([i + 1, i, i + 2, 1])]
          .filter((x) => x >= 0)
          .sort((a, b) => a - b)
          .map(String);
      },
      answer: (trace, at) => String(Number(trace.steps[at].vars.i) + 1),
      because: () =>
        'Indices 0 through i have all been compared once this one finishes, which is i + 1 elements. Linear search rules out exactly one element per comparison — that one-to-one rate is what makes it O(n).',
    },
  ],
};
