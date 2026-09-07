import { cell, ev, vr } from '../trace/tracer';
import { conceptual } from './checkpoints';
import { AlgorithmDef, RunFn } from './types';

const CPP = `int maxSubarraySum(vector<int>& arr) {
    int n = arr.size();
    int best = arr[0];

    for (int i = 0; i < n; i++) {
        int sum = 0;

        for (int j = i; j < n; j++) {
            sum = sum + arr[j];

            if (sum > best)
                best = sum;
        }
    }

    return best;
}`;

const C = `int maxSubarraySum(int arr[], int n) {
    int best = arr[0];
    int sum;

    for (int i = 0; i < n; i++) {
        sum = 0;

        for (int j = i; j < n; j++) {
            sum = sum + arr[j];

            if (sum > best)
                best = sum;
        }
    }

    return best;
}`;

const JAVA = `int maxSubarraySum(int[] arr) {
    int n = arr.length;
    int best = arr[0];

    for (int i = 0; i < n; i++) {
        int sum = 0;

        for (int j = i; j < n; j++) {
            sum = sum + arr[j];

            if (sum > best)
                best = sum;
        }
    }

    return best;
}`;

const run: RunFn = (input, t, mut) => {
  const arr = (input.array ?? []).slice();
  const n = arr.length;

  t.array('arr', arr, 'arr');

  if (n === 0) {
    t.step(3, { n, i: null, j: null, sum: null, best: null }, 'The array is empty, so arr[0] does not exist. This implementation assumes at least one element.');
    return 'empty';
  }

  const bestZero = mut.has('best-zero');
  const noReset = mut.has('no-reset');

  let best = bestZero ? 0 : arr[0];
  let bestL = 0;
  let bestR = 0;
  let sum = 0;
  /** Ranges considered, and elements added into a total to serve them. */
  let ranges = 0;
  let additions = 0;

  t.oracle({ answer: trueBest(arr) });
  t.enter('maxSubarraySum', 'maxSubarraySum(arr)');
  t.step(2, { n, i: null, j: null, sum: null, best }, `${n} elements. Still every starting point, but the total is now carried instead of rebuilt.`);
  t.derive({ bestL, bestR });
  t.step(3, { n, i: null, j: null, sum: null, best }, bestZero ? 'Start from zero.' : `Start from the first element, ${arr[0]}.`);

  for (let i = 0; i < n; i++) {
    t.step(5, { n, i, j: null, sum, best }, `Every subarray starting at index ${i}.`, ev.cmp(vr('i'), '<', vr('n'), true));

    if (!noReset) {
      sum = 0;
      t.step(6, { n, i, j: null, sum, best }, 'Reset the running total — a new starting point means a new total.');
    } else {
      t.step(6, { n, i, j: null, sum, best }, `The total is not reset, so it still holds ${sum} from the previous starting point.`);
    }

    for (let j = i; j < n; j++) {
      // One range considered, one element folded into the running total. The
      // whole difference from the brute-force version is that these two stay
      // equal instead of the second growing with the length of the range.
      ranges++;
      additions++;
      sum += arr[j];
      t.step(
        9,
        { n, i, j, sum, best },
        `Extend the subarray to index ${j} by adding ${arr[j]}. The total for arr[${i}..${j}] is ${sum} — reached with one addition, not ${j - i + 1}.`,
        ev.cmp(cell('arr', j), '+', vr('sum'), true),
      );

      const better = sum > best;
      t.step(11, { n, i, j, sum, best }, better ? `${sum} beats the best so far (${best}).` : `${sum} does not beat ${best}.`, ev.cmp(vr('sum'), '>', vr('best'), better));

      if (better) {
        best = sum;
        bestL = i;
        bestR = j;
        t.derive({ bestL, bestR });
        t.step(12, { n, i, j, sum, best }, `New best: ${best}, from index ${i} to ${j}.`);
      }
    }
  }

  t.exit();
  // Add up the range it says it found, and see whether that is the number
  // it reported. No oracle involved — the array is right there.
  t.derive({
    ranges,
    additions,
    bestReal: arr.slice(bestL, bestR + 1).reduce((a, b) => a + b, 0) === best ? 1 : 0,
  });
  t.step(17, { n, i: null, j: null, sum: null, best }, `The largest subarray sum is ${best}.`);
  return best;
};

function trueBest(arr: number[]): number {
  let best = arr[0];
  let cur = arr[0];
  for (let i = 1; i < arr.length; i++) {
    cur = Math.max(arr[i], cur + arr[i]);
    best = Math.max(best, cur);
  }
  return best;
}

export const maxSubarrayPrefix: AlgorithmDef = {
  slug: 'max-subarray-prefix',
  name: 'Maximum Subarray — running total',
  category: 'dp',
  tagline: 'Same subarrays as the brute force, without adding any of them up twice.',
  intuition: [
    'The brute force computes the sum of arr[i..j] from scratch, having just computed the sum of arr[i..j-1]. Those two differ by exactly one element. Keep the total and add that element instead, and the innermost loop disappears.',
    'Nothing else changes. The same subarrays are considered, in the same order, and the same answer comes out — only the accounting is different. That is what makes this the honest middle rung: it is a mechanical removal of repeated work, not a new idea about the problem.',
    'It is also a warning. Going from cubic to quadratic feels like a real win, and on an array of a thousand it is a thousandfold one. It is still quadratic, and the next rung is where the actual insight lives.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'arr',
    pointers: [
      { var: 'i', on: 'arr', role: 'window-start', label: 'i', hint: 'Where the subarray starts.' },
      { var: 'j', on: 'arr', role: 'window-end', label: 'j', hint: 'The element just added to the running total.' },
    ],
    regions: [
      { on: 'arr', kind: 'considering', from: 'i', to: 'j', label: 'the running total covers this' },
      { on: 'arr', kind: 'found', from: 'bestL', to: 'bestR', label: 'best so far' },
    ],
    invariant: {
      text: 'best is the largest sum among every subarray tried so far.',
      check: 'best <= answer',
      when: 'defined(best)',
      why: 'The same claim the brute force makes, and it has to be: this rung exists to be faster, not to be different. If the two ever disagreed, one of them would be wrong — which is exactly the check the ladder runs.',
    },
    postcondition: {
      text: 'The reported best really is the sum of the subarray it claims to have found.',
      check: 'bestReal === 1',
      when: 'n > 0',
      why: 'A self-check that needs no oracle at all: add up arr[bestL..bestR] and see whether it comes to best. Every version that computes a sum over the wrong range fails here immediately, because the range it recorded and the range it added up have come apart — while the running invariant, which only ever compares best against a bound, notices nothing.',
    },
    cost: {
      text: 'Each range costs one addition: the running total is extended by the next element, never rebuilt from the start.',
      check: 'additions === ranges',
      when: 'n > 0',
      why: 'This is the entire difference between this version and the brute-force one beside it, and the two return identical answers on every input — so the count is the only place a reader can be shown what changed. The brute force adds a range up from scratch every time, paying for its whole length; this carries the total forward and pays one. Reset that total in the wrong place and it still returns the right answer, having quietly become the algorithm it was meant to improve on.',
    },
  },
  run,
  defaultInput: { array: [-2, 1, -3, 4, -1, 2, 1, -5, 4] },
  fields: [{ key: 'array', label: 'Array', kind: 'array', help: 'Negative values are the interesting part.' }],
  makeInput: (n) => ({
    array: Array.from({ length: n }, (_, i) => ((i * 37) % 19) - 9),
  }),
  growthSizes: [16, 32, 64, 128, 192, 256, 384],
  projectTo: 100_000,
  complexity: {
    time: 'O(n²)',
    space: 'O(1)',
    note: 'One pass per starting point, and each pass touches every later element once. The third loop of the brute force is gone, and with it a factor of n.',
  },
  userLane: {
    fnName: 'maxSubarraySum',
    starters: {
      cpp: `int maxSubarraySum(vector<int>& arr) {
    int n = arr.size();
    int best = arr[0];

    for (int i = 0; i < n; i++) {
        int sum = 0;
        for (int j = i; j < n; j++) {
            sum = sum + arr[j];
            if (sum > best) best = sum;
        }
    }
    return best;
}`,
      c: `int maxSubarraySum(int arr[], int n) {
    int best = arr[0];

    for (int i = 0; i < n; i++) {
        int sum = 0;
        for (int j = i; j < n; j++) {
            sum = sum + arr[j];
            if (sum > best) best = sum;
        }
    }
    return best;
}`,
      java: `int maxSubarraySum(int[] arr) {
    int n = arr.length;
    int best = arr[0];

    for (int i = 0; i < n; i++) {
        int sum = 0;
        for (int j = i; j < n; j++) {
            sum = sum + arr[j];
            if (sum > best) best = sum;
        }
    }
    return best;
}`,
      js: `function maxSubarraySum(arr) {
  if (arr.length === 0) return 'empty';
  let best = arr[0];
  for (let i = 0; i < arr.length; i++) {
    let sum = 0;
    for (let j = i; j < arr.length; j++) {
      sum = sum + arr[j];
      if (sum > best) { best = sum; }
    }
  }
  return best;
}`,
    },
    compareBy: 'return',
    precondition: (input) => (input.array?.length ?? 0) > 0,
  },
  mutations: [
    {
      id: 'best-zero',
      edits: [
        { line: 3, from: 'int best = arr[0];', to: 'int best = 0;', langs: ['cpp', 'java'] },
        { line: 2, from: 'int best = arr[0];', to: 'int best = 0;', langs: ['c'] },
      ],
      label: 'best starts at 0',
      note: 'Permits the empty subarray, which the problem does not.',
    },
    {
      id: 'no-reset',
      edits: [
        { line: 6, from: 'int sum = 0;', to: '// int sum = 0;', langs: ['cpp', 'java'] },
        { line: 6, from: 'sum = 0;', to: '// sum = 0;', langs: ['c'] },
      ],
      label: 'never reset the total',
      note: 'The running total carries over from the previous starting point.',
    },
  ],
  variants: [
    {
      id: 'best-zero',
      label: 'best seeded with zero',
      blurb: 'Correct on most arrays. Returns 0 when every element is negative.',
      explanation:
        'Exactly the same bug as at the rung below, for exactly the same reason: 0 is the sum of the empty subarray, and the empty subarray is not one of the choices. Its survival across two very different implementations is the point — this is a misunderstanding of the problem, and no amount of optimising the code will surface it.',
      mutations: ['best-zero'],
    },
    {
      id: 'no-reset',
      label: 'The running total is never reset',
      blurb: 'Sums ranges that were never asked about.',
      explanation:
        'The whole trick of this rung is that sum means "the total of arr[i..j]". Skip the reset and after the first starting point it means something with no name at all — a total that spans several starting points. The saving is only sound because the quantity being carried is still the quantity being asked about; carry the wrong thing and the speed is free but the answer is not.',
      mutations: ['no-reset'],
    },
  ],
  edgeCases: [
    { id: 'mixed', label: 'Mixed signs', input: { array: [-2, 1, -3, 4, -1, 2, 1, -5, 4] }, why: 'The textbook case, and the same answer as every other rung.' },
    { id: 'all-negative', label: 'All negative', input: { array: [-8, -3, -6, -2, -5] }, why: 'The answer is the least-bad single element.' },
    { id: 'all-positive', label: 'All positive', input: { array: [2, 3, 1, 5] }, why: 'The running total never has a reason to be abandoned.' },
    { id: 'single', label: 'One element', input: { array: [-4] }, why: 'The inner loop runs once, and never resets anything.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 6, nth: 1 },
      question: 'Why is sum reset here, at the start of every outer round?',
      options: [
        'Because it means "the total of arr[i..j]" and i has just changed',
        'To avoid integer overflow',
        'Because the previous total was wrong',
        'It is not necessary — the inner loop overwrites it',
      ],
      answer: 'Because it means "the total of arr[i..j]" and i has just changed',
      because:
        'The saving only works because the number being carried is the number being asked about. Skip the reset and sum starts meaning something with no name — a total spanning several starting points — and the speed is still there while the answer is not. Carrying the wrong quantity cheaply is not an optimisation.',
    }),
    conceptual({
      where: { line: 9, nth: 3 },
      question: 'This rung considers exactly the same subarrays as the brute force. Where does the factor of n go?',
      options: [
        'Extending a subarray by one element now costs one addition instead of a whole re-sum',
        'Fewer subarrays are considered',
        'The comparisons are cheaper',
        'The array is scanned in a different order',
      ],
      answer: 'Extending a subarray by one element now costs one addition instead of a whole re-sum',
      because:
        'Nothing about the search changed — the same pairs of endpoints, in the same order, giving the same answer. Only the accounting is different. That is what makes this the honest middle rung: a mechanical removal of repeated work rather than a new idea about the problem, and it is still quadratic.',
    }),
    {
      locate: (trace) => trace.steps.findIndex((s) => s.line === 9 && Number(s.vars.i) === 0 && Number(s.vars.j) === 2),
      question: (trace, at) => {
        const v = trace.steps[at].vars;
        return `sum is now ${v.sum}, covering arr[0..2]. How many additions did this iteration perform?`;
      },
      options: () => ['1', '2', '3', 'n'],
      answer: () => '1',
      because: () =>
        'The total for arr[0..1] was already in hand, so extending to arr[0..2] costs a single addition. The brute force would have done three. That one difference, repeated for every pair of endpoints, is the entire factor of n between the two rungs — the set of subarrays considered is identical.',
    },
  ],
};
