import { cell, ev, vr } from '../trace/tracer';
import { Tracer } from '../trace/tracer';
import { computed, conceptual } from './checkpoints';
import { AlgorithmDef, RunFn } from './types';

const CPP = `int maxSubarraySum(vector<int>& arr) {
    int best = arr[0];
    int current = arr[0];
    int start = 0, bestL = 0, bestR = 0;

    for (int i = 1; i < arr.size(); i++) {
        if (current + arr[i] < arr[i]) {
            current = arr[i];
            start = i;
        } else {
            current = current + arr[i];
        }

        if (current > best) {
            best = current;
            bestL = start;
            bestR = i;
        }
    }

    return best;
}`;

const C = `int maxSubarraySum(int arr[], int n) {
    int best = arr[0];
    int current = arr[0];
    int start = 0, bestL = 0, bestR = 0;

    for (int i = 1; i < n; i++) {
        if (current + arr[i] < arr[i]) {
            current = arr[i];
            start = i;
        } else {
            current = current + arr[i];
        }

        if (current > best) {
            best = current;
            bestL = start;
            bestR = i;
        }
    }

    return best;
}`;

const JAVA = `int maxSubarraySum(int[] arr) {
    int best = arr[0];
    int current = arr[0];
    int start = 0, bestL = 0, bestR = 0;

    for (int i = 1; i < arr.length; i++) {
        if (current + arr[i] < arr[i]) {
            current = arr[i];
            start = i;
        } else {
            current = current + arr[i];
        }

        if (current > best) {
            best = current;
            bestL = start;
            bestR = i;
        }
    }

    return best;
}`;

/** The true answer for arr[0..i], found by brute force, so `best` can be checked. */
function derive(t: Tracer, arr: number[], i: number) {
  if (!t.tracing) return;
  let truth = -Infinity;
  for (let l = 0; l <= i; l++) {
    let sum = 0;
    for (let r = l; r <= i; r++) {
      sum += arr[r];
      truth = Math.max(truth, sum);
    }
  }
  t.derive({ trueBestSoFar: truth });
}

interface Opts {
  /** The buggy version starts `best` at zero instead of the first element. */
  bestStartsZero: boolean;
  /** The buggy version forgets to record where the new run began. */
  trackStart: boolean;
}

function makeRun(opts: Opts): RunFn {
  return (input, t) => {
    const arr = (input.array ?? []).slice();
    const n = arr.length;
    t.array('arr', arr, 'arr');
    t.enter('maxSubarraySum', 'maxSubarraySum(arr)');

    if (n === 0) {
      t.step(1, { i: null, current: null, best: null, start: null, bestL: null, bestR: null }, 'The array is empty, so arr[0] does not exist. This implementation assumes at least one element.');
      t.exit();
      return 'empty';
    }

    let best = opts.bestStartsZero ? 0 : arr[0];
    let current = arr[0];
    let start = 0;
    let bestL = 0;
    let bestR = 0;
    let i: number | null = null;

    derive(t, arr, 0);
    t.step(2, { i, current, best, start, bestL, bestR }, () => `The best sum seen so far starts at ${best}${opts.bestStartsZero ? ' — zero, before looking at anything.' : `, the first element.`}`);
    t.step(3, { i, current, best, start, bestL, bestR }, () => `current is the best sum of any run ending at the element we are standing on. Right now that is just ${arr[0]}.`);
    t.step(4, { i, current, best, start, bestL, bestR }, 'start, bestL and bestR only record where the runs are — they do not affect the answer.');

    for (i = 1; i < n; i++) {
      t.tick();
      const restart = current + arr[i] < arr[i];
      t.step(
        6,
        { i, current, best, start, bestL, bestR },
        () =>
          `Extending the run gives ${current} + ${arr[i as number]} = ${(current as number) + arr[i as number]}; starting fresh at arr[${i}] gives ${arr[i as number]}. ${restart ? 'Starting fresh is better — the run so far is dragging us down.' : 'Extending is at least as good.'}`,
        ev.cmp(vr('current'), '+arr[i] <', cell('arr', i), restart),
      );

      if (restart) {
        current = arr[i];
        t.step(7, { i, current, best, start, bestL, bestR }, () => `Throw the old run away. current becomes ${current}.`);
        if (opts.trackStart) {
          start = i;
          t.step(8, { i, current, best, start, bestL, bestR }, () => `The new run begins at index ${start}.`);
        }
      } else {
        current = current + arr[i];
        t.step(11, { i, current, best, start, bestL, bestR }, () => `Extend the run: current becomes ${current}.`);
      }

      const better = current > best;
      // The prefix truth still covers arr[0..i-1] here, which is exactly what
      // `best` is claiming at this moment — it has not absorbed arr[i] yet.
      t.step(14, { i, current, best, start, bestL, bestR }, () => `Is ${current} better than the best so far, ${best}? ${better ? 'Yes.' : 'No — keep the old best.'}`, ev.cmp(vr('current'), '>', vr('best'), better));

      if (better) {
        best = current;
        bestL = start;
        bestR = i;
        derive(t, arr, i);
        t.step(15, { i, current, best, start, bestL, bestR }, () => `New best: ${best}, from arr[${bestL}..${bestR}].`);
      } else {
        derive(t, arr, i);
      }
    }

    t.derive({
      bestReal:
        arr.slice(bestL as number, (bestR as number) + 1).reduce((a, b) => a + b, 0) === best
          ? 1
          : 0,
    });
    t.step(21, { i, current, best, start, bestL, bestR }, () => `The largest sum of any contiguous run is ${best}, achieved by arr[${bestL}..${bestR}].`, ev.ret('maxSubarraySum', best));
    t.exit();
    return best;
  };
}

const run: RunFn = (input, t, mut) =>
  makeRun({
    bestStartsZero: mut.has('best-zero'),
    trackStart: !mut.has('no-start-reset'),
  })(input, t, mut);

export const kadane: AlgorithmDef = {
  slug: 'maximum-subarray',
  name: "Maximum Subarray (Kadane's)",
  category: 'dp',
  tagline: 'Find the contiguous run with the largest sum, in a single pass.',
  intuition: [
    'The brute-force version tries every start and every end — n² runs. Kadane\'s does it in one pass by asking a much smaller question at each element: what is the best run that *ends right here*?',
    'That question has a two-line answer. Either you extend the best run ending at the previous element, or that run was so bad you are better off starting fresh at the current element. Nothing else can win, because any run ending here either includes the previous element or does not.',
    'Once you know the best run ending at every position, the overall answer is just the largest of those. current tracks the local question; best remembers the global one. Watch them move independently — current can fall while best stays put.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'arr',
    pointers: [
      { var: 'i', on: 'arr', role: 'cursor', label: 'i', hint: 'The element being folded in.' },
      { var: 'start', on: 'arr', role: 'boundary', label: 'start', hint: 'Where the current run began.' },
    ],
    regions: [
      { on: 'arr', kind: 'sorted', from: 'bestL', to: 'bestR', label: 'best run so far' },
      { on: 'arr', kind: 'active', from: 'start', to: 'i', label: 'current run' },
    ],
    invariant: {
      text: 'best always equals the true maximum subarray sum of everything seen so far.',
      check: 'best === trueBestSoFar',
      when: 'defined(trueBestSoFar) && defined(best)',
      why: 'Checked against a brute-force scan of the prefix at every step. This is what makes the one-pass trick trustworthy: the answer is never provisional or approximate, it is exactly right for the part of the array already read — which is why the loop can simply stop at the end and return.',
    },
    postcondition: {
      text: 'The reported best really is the sum of the subarray it claims to have found.',
      check: 'bestReal === 1',
      when: 'n > 0',
      why: 'A self-check that needs no oracle at all: add up arr[bestL..bestR] and see whether it comes to best. Every version that computes a sum over the wrong range fails here immediately, because the range it recorded and the range it added up have come apart — while the running invariant, which only ever compares best against a bound, notices nothing.',
    },
    cost: {
      text: 'One pass: the loop never runs more times than the array is long.',
      check: 'ops_iterations <= n',
      why: 'Kadane’s whole claim is that the quadratic search collapses to a single sweep, because the best subarray ending at each index can be built from the one ending before it. That is a claim about work, not about the answer — the brute-force version on this site returns exactly the same number. If this bound breaks, what is left is a slower algorithm giving a right answer, which is the thing the reader came here to be able to tell apart.',
    },
  },
  run,
  defaultInput: { array: [-2, 1, -3, 4, -1, 2, 1, -5, 4] },
  fields: [{ key: 'array', label: 'Array', kind: 'array', help: 'Negative values are the interesting part. Try one that is all negative.' }],
  makeInput: (n) => ({ array: Array.from({ length: n }, (_, k) => (((k * 7919) % 21) - 10)) }),
  growthSizes: [16, 32, 64, 128, 256, 512, 1024, 2048],
  projectTo: 1_000_000,
  complexity: {
    time: 'O(n)',
    space: 'O(1)',
    note: 'One pass, a constant amount of work per element, and no extra storage. The brute-force alternative is O(n²) — or O(n³) if you re-add each run from scratch.',
  },
  userLane: {
    fnName: 'maxSubarraySum',
    starters: {
      cpp: `int maxSubarraySum(vector<int>& arr) {
    int best = arr[0];
    int current = arr[0];

    for (int i = 1; i < arr.size(); i++) {
        if (current + arr[i] < arr[i]) {
            current = arr[i];
        } else {
            current = current + arr[i];
        }

        if (current > best) {
            best = current;
        }
    }
    return best;
}`,
      c: `int maxSubarraySum(int arr[], int n) {
    int best = arr[0];
    int current = arr[0];

    for (int i = 1; i < n; i++) {
        if (current + arr[i] < arr[i]) {
            current = arr[i];
        } else {
            current = current + arr[i];
        }

        if (current > best) {
            best = current;
        }
    }
    return best;
}`,
      java: `int maxSubarraySum(int[] arr) {
    int best = arr[0];
    int current = arr[0];

    for (int i = 1; i < arr.length; i++) {
        if (current + arr[i] < arr[i]) {
            current = arr[i];
        } else {
            current = current + arr[i];
        }

        if (current > best) {
            best = current;
        }
    }
    return best;
}`,
      js: `function maxSubarraySum(arr) {
  if (arr.length === 0) return 'empty';

  let best = arr[0];
  let current = arr[0];

  for (let i = 1; i < arr.length; i++) {
    if (current + arr[i] < arr[i]) {
      current = arr[i];
    } else {
      current = current + arr[i];
    }

    if (current > best) {
      best = current;
    }
  }
  return best;
}`,
    },
    precondition: (input) => (input.array?.length ?? 0) > 0,
    compareBy: 'return',
  },
  mutations: [
    {
      id: 'best-zero',
      edits: [{ line: 2, from: 'int best = arr[0];', to: 'int best = 0;' }],
      label: 'best starts at 0',
      note: 'Quietly permits the empty subarray, so an all-negative array returns 0.',
    },
    {
      id: 'no-start-reset',
      edits: [{ line: 9, from: 'start = i;', to: '// start = i;' }],
      label: 'never move start',
      note: 'The sum stays right but the reported range points at the wrong stretch.',
    },
  ],
  variants: [
    {
      id: 'best-zero',
      label: 'int best = 0',
      blurb: 'Returns 0 for an array with no positive numbers in it.',
      explanation:
        'Starting best at zero quietly assumes the empty run is allowed. When every element is negative, no real run can beat 0, so the algorithm returns 0 — a sum belonging to a subarray that was never permitted. The fix is to seed best with a value the problem actually admits: the first element.',
      mutations: ['best-zero'],
    },
    {
      id: 'no-start-reset',
      label: 'start is never updated',
      blurb: 'Reports the right total, but points at the wrong stretch of the array.',
      explanation:
        'best is computed only from current, so the returned sum stays correct — this bug is completely invisible if you only check the number. But bestL is copied from start, and start never moves off 0, so the reported range covers elements the winning run does not include. A test that also asserted the indices would have caught it; a test that checked only the sum would not.',
      mutations: ['no-start-reset'],
    },
  ],
  edgeCases: [
    { id: 'mixed', label: 'Mixed signs', input: { array: [-2, 1, -3, 4, -1, 2, 1, -5, 4] }, why: 'The textbook case. Watch current restart when the running total goes worse than starting over.' },
    { id: 'all-negative', label: 'All negative', input: { array: [-8, -3, -6, -2, -5] }, why: 'The answer is the least-bad single element. This is the case a best of 0 gets wrong.' },
    { id: 'all-positive', label: 'All positive', input: { array: [2, 3, 1, 5] }, why: 'The whole array wins and current never restarts.' },
    { id: 'single-neg', label: 'One negative element', input: { array: [-4] }, why: 'The loop never runs; the answer is whatever best was seeded with.' },
    { id: 'zeros', label: 'Zeros and negatives', input: { array: [-1, 0, -2, 0] }, why: 'The best sum is 0, but it comes from a real element — not from an empty run.' },
  ],
  checkpoints: [
    conceptual({
      // Line 7 is the restart branch, which the default input takes twice.
      where: { line: 7, nth: 1 },
      question: 'This test asks whether starting fresh at arr[i] beats extending. What does answering it let the algorithm stop doing?',
      options: [
        'Considering every possible starting point',
        'Adding up subarrays',
        'Comparing against best',
        'Scanning the array at all',
      ],
      answer: 'Considering every possible starting point',
      because:
        'The rungs below try every start. This one observes that a run which has gone negative can never help what follows, so there is exactly one start worth carrying — and the question of where the best subarray begins is answered incrementally rather than searched for. That is the step from quadratic to linear, and it is a change of question rather than a change of bookkeeping.',
    }),
    computed({
      where: { line: 14, nth: 2 },
      question: () => 'What does current hold at this point?',
      answer: () => 'The best sum of any run ending at the current element',
      options: (a) => [
        a,
        'The best sum found anywhere so far',
        'The sum of the whole array up to here',
        'The largest single element seen so far',
      ],
      because:
        'Two variables, two different meanings, and mixing them up is the most common way this gets written wrong. current is anchored to the current index and may be poor; best is the best over everything seen and never goes down. The comparison between them is the only place best changes.',
    }),
    {
      locate: (trace) => trace.steps.findIndex((s) => s.line === 6),
      question: (trace, at) => {
        const v = trace.steps[at].vars;
        return `current is ${v.current} and the next element is being folded in. What does current represent right now?`;
      },
      options: () => [
        'The best sum of any run ending at the current element',
        'The best sum found anywhere so far',
        'The sum of the whole array up to here',
        'The largest single element seen so far',
      ],
      answer: () => 'The best sum of any run ending at the current element',
      because: () =>
        'That is the local question Kadane\'s answers at each step, and it is why one pass suffices. best is the separate running maximum of all those local answers — the two are allowed to disagree, and usually do.',
    },
  ],
};
