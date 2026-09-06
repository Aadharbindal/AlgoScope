import { cell, ev, vr } from '../trace/tracer';
import { computed, conceptual, num } from './checkpoints';
import { AlgorithmDef, RunFn } from './types';

const CPP = `int maxSubarraySum(vector<int>& arr) {
    int n = arr.size();
    int best = arr[0];

    for (int i = 0; i < n; i++) {
        for (int j = i; j < n; j++) {
            int sum = 0;

            for (int k = i; k <= j; k++)
                sum = sum + arr[k];

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
        for (int j = i; j < n; j++) {
            sum = 0;

            for (int k = i; k <= j; k++)
                sum = sum + arr[k];

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
        for (int j = i; j < n; j++) {
            int sum = 0;

            for (int k = i; k <= j; k++)
                sum = sum + arr[k];

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
    t.step(3, { n, i: null, j: null, k: null, sum: null, best: null }, 'The array is empty, so arr[0] does not exist. This implementation assumes at least one element.');
    return 'empty';
  }

  // Seeding best with zero quietly permits the empty subarray — the same bug
  // that appears at every rung of this ladder.
  const bestZero = mut.has('best-zero');
  const innerFromZero = mut.has('inner-from-zero');

  let best = bestZero ? 0 : arr[0];
  let bestL = 0;
  let bestR = 0;
  /** Cells the ranges cover, and cells actually added into their totals. */
  let spanTotal = 0;
  let termsAdded = 0;

  t.oracle({ answer: trueBest(arr) });
  t.enter('maxSubarraySum', `maxSubarraySum(arr)`);
  t.step(2, { n, i: null, j: null, k: null, sum: null, best }, `${n} elements, so there are ${(n * (n + 1)) / 2} subarrays to consider.`);
  t.derive({ bestL, bestR });
  t.step(3, { n, i: null, j: null, k: null, sum: null, best }, bestZero ? 'Start from zero.' : `Start from the first element, ${arr[0]}, which is a real subarray of length one.`);

  for (let i = 0; i < n; i++) {
    t.step(5, { n, i, j: null, k: null, sum: null, best }, `Consider every subarray that starts at index ${i}.`, ev.cmp(vr('i'), '<', vr('n'), true));

    for (let j = i; j < n; j++) {
      t.step(6, { n, i, j, k: null, sum: null, best }, `The subarray from ${i} to ${j}.`, ev.cmp(vr('j'), '<', vr('n'), true));

      let sum = 0;
      t.step(7, { n, i, j, k: null, sum, best }, 'Start the total from nothing — every element in this range is about to be added again.');

      // How many cells this range holds, against how many are actually added
      // into its total. A sum built from the wrong span shows up here even
      // when the number it produces happens to be believable.
      spanTotal += j - i + 1;

      const from = innerFromZero ? 0 : i;
      for (let k = from; k <= j; k++) {
        termsAdded++;
        t.step(9, { n, i, j, k, sum, best }, `Add arr[${k}] = ${arr[k]}.`, ev.read('arr', k));
        sum += arr[k];
        t.step(10, { n, i, j, k, sum, best }, `The running total is now ${sum}.`, ev.cmp(cell('arr', k), '+', vr('sum'), true));
      }

      const better = sum > best;
      t.step(12, { n, i, j, k: null, sum, best }, better ? `${sum} beats the best so far (${best}).` : `${sum} does not beat ${best}.`, ev.cmp(vr('sum'), '>', vr('best'), better));

      if (better) {
        best = sum;
        bestL = i;
        bestR = j;
        t.derive({ bestL, bestR });
        t.step(13, { n, i, j, k: null, sum, best }, `New best: ${best}, from index ${i} to ${j}.`);
      }
    }
  }

  t.exit();
  // Add up the range it says it found, and see whether that is the number
  // it reported. No oracle involved — the array is right there.
  t.derive({
    bestReal: arr.slice(bestL, bestR + 1).reduce((a, b) => a + b, 0) === best ? 1 : 0,
    spanTotal,
    termsAdded,
  });
  t.step(17, { n, i: null, j: null, k: null, sum: null, best }, `The largest subarray sum is ${best}.`);
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

export const maxSubarrayBrute: AlgorithmDef = {
  slug: 'max-subarray-brute',
  name: 'Maximum Subarray — brute force',
  category: 'dp',
  tagline: 'Try every subarray, add it up, keep the largest. The obvious answer, written out.',
  intuition: [
    'The problem asks for the best subarray, so this tries every subarray. Two loops choose the endpoints and a third adds up what is between them. Nothing is clever, and nothing is wrong.',
    'It is worth writing once, because it is the definition of the problem turned directly into code — and because it is the thing the faster versions have to agree with. Every other approach on this ladder is only trustworthy insofar as it returns what this returns.',
    'Watch the innermost loop. It re-adds a range that overlaps almost entirely with the range it added a moment ago. That single observation is the whole of the next rung.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'arr',
    pointers: [
      { var: 'i', on: 'arr', role: 'window-start', label: 'i', hint: 'Where the subarray being tried starts.' },
      { var: 'j', on: 'arr', role: 'window-end', label: 'j', hint: 'Where it ends.' },
      { var: 'k', on: 'arr', role: 'probe', label: 'k', hint: 'The element being added right now.' },
    ],
    regions: [
      { on: 'arr', kind: 'considering', from: 'i', to: 'j', label: 'the subarray being tried' },
      { on: 'arr', kind: 'found', from: 'bestL', to: 'bestR', label: 'best so far' },
    ],
    invariant: {
      text: 'best is the largest sum among every subarray tried so far.',
      check: 'best <= answer',
      when: 'defined(best)',
      why: 'Having tried only some of the subarrays, best cannot yet exceed the true maximum — it can only be too small, and only until the right pair of endpoints comes up. Seed best with zero instead of a real element and it can start out larger than any subarray actually permits, which breaks the claim before the loop even runs.',
    },
    postcondition: {
      text: 'The reported best really is the sum of the subarray it claims to have found.',
      check: 'bestReal === 1',
      when: 'n > 0',
      why: 'A self-check that needs no oracle at all: add up arr[bestL..bestR] and see whether it comes to best. Every version that computes a sum over the wrong range fails here immediately, because the range it recorded and the range it added up have come apart — while the running invariant, which only ever compares best against a bound, notices nothing.',
    },
    cost: {
      text: 'Adding up a range touches exactly as many cells as the range holds.',
      check: 'termsAdded === spanTotal',
      when: 'n > 0',
      why: 'The claim above catches a wrong sum by re-adding the winning range — but only when the winner is the range that was summed wrongly. Start the inner sum at zero instead of at i and every total is taken over a longer span than the one it is recorded against; on an input whose best subarray happens to begin at index 0 the two agree anyway, the answer is wrong, and nothing above notices. This claim does not depend on which range won. It says the work matches the range, for every range, and a sum built over the wrong span cannot satisfy it whatever answer it arrives at.',
    },
  },
  run,
  defaultInput: { array: [-2, 1, -3, 4, -1, 2, 1, -5, 4] },
  fields: [{ key: 'array', label: 'Array', kind: 'array', help: 'Negative values are the interesting part.' }],
  makeInput: (n) => ({
    array: Array.from({ length: n }, (_, i) => ((i * 37) % 19) - 9),
  }),
  growthSizes: [8, 12, 16, 24, 32, 48, 64],
  projectTo: 100_000,
  complexity: {
    time: 'O(n³)',
    space: 'O(1)',
    note: 'Two loops to pick the endpoints, and a third to add up what lies between them. The third loop is the one that hurts: it repeats work the previous iteration already did. Measured on much smaller inputs than the other rungs, because at n = 2048 this would be around ten billion operations.',
  },
  userLane: {
    fnName: 'maxSubarraySum',
    starters: {
      cpp: `int maxSubarraySum(vector<int>& arr) {
    int n = arr.size();
    int best = arr[0];

    for (int i = 0; i < n; i++) {
        for (int j = i; j < n; j++) {
            int sum = 0;
            for (int k = i; k <= j; k++) sum = sum + arr[k];
            if (sum > best) best = sum;
        }
    }
    return best;
}`,
      c: `int maxSubarraySum(int arr[], int n) {
    int best = arr[0];

    for (int i = 0; i < n; i++) {
        for (int j = i; j < n; j++) {
            int sum = 0;
            for (int k = i; k <= j; k++) sum = sum + arr[k];
            if (sum > best) best = sum;
        }
    }
    return best;
}`,
      java: `int maxSubarraySum(int[] arr) {
    int n = arr.length;
    int best = arr[0];

    for (int i = 0; i < n; i++) {
        for (int j = i; j < n; j++) {
            int sum = 0;
            for (int k = i; k <= j; k++) sum = sum + arr[k];
            if (sum > best) best = sum;
        }
    }
    return best;
}`,
      js: `function maxSubarraySum(arr) {
  if (arr.length === 0) return 'empty';
  let best = arr[0];
  for (let i = 0; i < arr.length; i++) {
    for (let j = i; j < arr.length; j++) {
      let sum = 0;
      for (let k = i; k <= j; k++) { sum = sum + arr[k]; }
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
      id: 'inner-from-zero',
      // The inner loop lands on the same line in all three; only the `best`
      // declaration above it shifts, because C hoists `sum` out of the loop.
      edits: [{ line: 9, from: 'for (int k = i; k <= j; k++)', to: 'for (int k = 0; k <= j; k++)' }],
      label: 'inner loop starts at 0',
      note: 'Sums from the front of the array rather than from i, so i stops meaning anything.',
    },
  ],
  variants: [
    {
      id: 'best-zero',
      label: 'best seeded with zero',
      blurb: 'Correct on most arrays. Returns 0 when every element is negative.',
      explanation:
        'Seeding best with 0 asserts that a sum of zero is always available — that is, that the empty subarray counts. When some element is positive the answer is positive anyway and nothing shows. When every element is negative, no real subarray can beat 0, so the function returns a sum belonging to a subarray it was never allowed to choose. The same bug exists at every rung of this ladder, which is worth noticing: it is a bug about the problem, not about the technique.',
      mutations: ['best-zero'],
    },
    {
      id: 'inner-from-zero',
      label: 'inner loop starts at 0',
      blurb: 'Adds up the wrong range, and often reports a larger answer than exists.',
      explanation:
        'The subarray under consideration is arr[i..j], but summing from 0 to j measures arr[0..j] instead. The outer loop over i still runs, so the same range gets measured n times and i has no effect on anything. Watch the highlighted range against the pointer for k — they no longer agree, which is the visible form of the bug.',
      mutations: ['inner-from-zero'],
    },
  ],
  edgeCases: [
    { id: 'mixed', label: 'Mixed signs', input: { array: [-2, 1, -3, 4, -1, 2, 1, -5, 4] }, why: 'The textbook case. Forty-five subarrays get tried for an array of nine.' },
    { id: 'all-negative', label: 'All negative', input: { array: [-8, -3, -6, -2, -5] }, why: 'The answer is the least-bad single element — the case a best of 0 gets wrong.' },
    { id: 'all-positive', label: 'All positive', input: { array: [2, 3, 1, 5] }, why: 'The whole array wins, and it is the very last subarray tried.' },
    { id: 'single', label: 'One element', input: { array: [-4] }, why: 'One subarray exists, so the loops run once.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 3 },
      question: 'best is seeded with arr[0] rather than 0. Why does that matter?',
      options: [
        'Because 0 is the sum of the empty subarray, which is not allowed',
        'Because arr[0] might be the answer',
        'Because 0 would make the loop slower',
        'It does not matter — both work',
      ],
      answer: 'Because 0 is the sum of the empty subarray, which is not allowed',
      because:
        'The problem asks for the best contiguous run of one or more elements. Seeding with 0 quietly admits a run of none, which only shows when every element is negative — and then the function returns a sum belonging to a subarray it was never permitted to choose. This is a misunderstanding of the question, not of the technique, which is why the same bug appears at every rung of this ladder.',
    }),
    computed({
      where: { line: 6, nth: 1 },
      question: (step) => `The endpoints are i = ${step.vars.i}, j = ${step.vars.j}. How many pairs of endpoints will be tried in total?`,
      answer: (step) => String((num(step, 'n') * (num(step, 'n') + 1)) / 2),
      options: (a, step) => [
        a,
        String(num(step, 'n')),
        String(num(step, 'n') * num(step, 'n')),
        String(num(step, 'n') * num(step, 'n') * num(step, 'n')),
      ],
      because:
        'Every pair with i ≤ j, which is n(n + 1)/2 — quadratic on its own. The third loop is what turns that into cubic, and it is the part that adds nothing: it recomputes a sum that overlaps almost entirely with the one computed a moment ago.',
    }),
    {
      locate: (trace) => trace.steps.findIndex((s) => s.line === 7 && Number(s.vars.i) === 0 && Number(s.vars.j) === 2),
      question: () =>
        'The sum of arr[0..1] was computed a moment ago. What does this iteration do with it?',
      options: () => [
        'Throws it away and adds arr[0..2] from scratch',
        'Adds arr[2] to it',
        'Looks it up in a table',
        'Compares it against the best so far',
      ],
      answer: () => 'Throws it away and adds arr[0..2] from scratch',
      because: () =>
        'sum is reset to 0 and the inner loop re-adds every element from i again. Almost all of that addition was done one iteration ago. Removing exactly this waste — keeping the running total instead of rebuilding it — is what turns O(n³) into O(n²), without changing which subarrays get considered.',
    },
  ],
};
