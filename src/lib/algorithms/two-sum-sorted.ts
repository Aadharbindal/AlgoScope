import { ev, vr } from '../trace/tracer';
import { Tracer } from '../trace/tracer';
import { computed, conceptual, num } from './checkpoints';
import { AlgorithmDef, Input, RunFn } from './types';

const CPP = `vector<int> twoSum(vector<int>& arr, int target) {
    int left = 0;
    int right = arr.size() - 1;

    while (left < right) {
        int sum = arr[left] + arr[right];

        if (sum == target)
            return {left, right};

        if (sum < target)
            left++;
        else
            right--;
    }

    return {-1, -1};
}`;

const C = `void twoSum(int arr[], int n, int target, int out[]) {
    int left = 0;
    int right = n - 1;

    while (left < right) {
        int sum = arr[left] + arr[right];

        if (sum == target)
            { out[0] = left; out[1] = right; return; }

        if (sum < target)
            left++;
        else
            right--;
    }

    out[0] = -1; out[1] = -1;
}`;

const JAVA = `int[] twoSum(int[] arr, int target) {
    int left = 0;
    int right = arr.length - 1;

    while (left < right) {
        int sum = arr[left] + arr[right];

        if (sum == target)
            return new int[] { left, right };

        if (sum < target)
            left++;
        else
            right--;
    }

    return new int[] { -1, -1 };
}`;

/** Does a valid pair still exist inside the window the algorithm has left? */
function pairExists(arr: number[], target: number, lo: number, hi: number): boolean {
  for (let l = lo; l <= hi; l++) {
    for (let r = l + 1; r <= hi; r++) {
      if (arr[l] + arr[r] === target) return true;
    }
  }
  return false;
}

function derive(t: Tracer, arr: number[], target: number, left: number, right: number) {
  if (!t.tracing) return;
  t.derive({ pairInWindow: pairExists(arr, target, left, right) ? 1 : 0 });
}

interface Opts {
  /** The buggy loop lets both pointers land on the same element. */
  allowSameIndex: boolean;
  /** The buggy branch moves whichever pointer cannot help. */
  swapBranches: boolean;
}

function makeRun(opts: Opts): RunFn {
  return (input, t) => {
    const arr = (input.array ?? []).slice();
    const target = Number(input.target ?? 0);
    const n = arr.length;

    t.array('arr', arr, 'arr');
    t.oracle({ hasPair: pairExists(arr, target, 0, n - 1) ? 1 : 0, target });
    t.enter('twoSum', `twoSum(arr, ${target})`);

    let left: number | null = null;
    let right: number | null = null;
    let sum: number | null = null;

    t.step(1, { left, right, sum, target }, `Find two values in this sorted array that add up to ${target}.`, ev.call('twoSum', `twoSum(arr, ${target})`));

    left = 0;
    t.step(2, { left, right, sum, target }, 'left starts at the smallest value.');

    right = n - 1;
    derive(t, arr, target, left, right);
    t.step(3, { left, right, sum, target }, () => `right starts at the largest. Between them sits every pair still worth considering.`);

    for (;;) {
      const keepGoing = opts.allowSameIndex ? left <= right : left < right;
      derive(t, arr, target, left, right);
      t.step(
        5,
        { left, right, sum, target },
        () =>
          keepGoing
            ? `The window is arr[${left}..${right}] — ${(right as number) - (left as number) + 1} value${(right as number) - (left as number) === 0 ? '' : 's'} still in play.`
            : `left and right have met. Every pair has been ruled out.`,
        ev.cmp(vr('left'), opts.allowSameIndex ? '<=' : '<', vr('right'), keepGoing),
      );
      if (!keepGoing) break;
      t.tick();

      sum = arr[left] + arr[right];
      t.step(6, { left, right, sum, target }, () => `arr[${left}] + arr[${right}] = ${arr[left as number]} + ${arr[right as number]} = ${sum}.`);

      const hit = sum === target;
      t.step(8, { left, right, sum, target }, () => `Is ${sum} equal to ${target}? ${hit ? 'Yes.' : 'No.'}`, ev.cmp(vr('sum'), '==', vr('target'), hit));
      if (hit) {
        // Two distinct indices whose values really add up. `left === right`
        // is the case the loop condition exists to prevent.
        t.derive({
          pairOk: left !== right && arr[left as number] + arr[right as number] === target ? 1 : 0,
        });
        t.step(9, { left, right, sum, target }, () => `Return the pair of indices ${left} and ${right}.`, ev.found('arr', left as number));
        t.exit();
        return `${left},${right}`;
      }

      const tooSmall = sum < target;
      t.step(11, { left, right, sum, target }, () => `${sum} is ${tooSmall ? 'smaller' : 'larger'} than ${target}.`, ev.cmp(vr('sum'), '<', vr('target'), tooSmall));

      const moveLeft = opts.swapBranches ? !tooSmall : tooSmall;
      if (moveLeft) {
        const dropped = arr[left];
        left++;
        derive(t, arr, target, left, right);
        t.step(12, { left, right, sum, target }, () => `The sum is too small, so ${dropped} — the smallest value left — cannot be part of any answer: every remaining partner is smaller than the one just tried. Drop it: left moves to ${left}.`);
      } else {
        const dropped = arr[right];
        right--;
        derive(t, arr, target, left, right);
        t.step(14, { left, right, sum, target }, () => `The sum is too large, so ${dropped} — the largest value left — is too big for every remaining partner. Drop it: right moves to ${right}.`);
      }
    }

    // No pair was returned, so the claim is that none exists.
    t.derive({ pairOk: anyPair(arr, target) ? 0 : 1 });
    t.step(17, { left, right, sum, target }, () => `No pair adds up to ${target}.`, ev.fail('window exhausted'));
    t.exit();
    return '-1,-1';
  };
}

const run: RunFn = (input, t, mut) =>
  makeRun({
    allowSameIndex: mut.has('same-index'),
    swapBranches: mut.has('swapped-branches'),
  })(input, t, mut);

const isSorted = (a: number[]) => a.every((v, i) => i === 0 || a[i - 1] <= v);

/** Whether any two distinct positions sum to the target. Computed separately. */
function anyPair(arr: number[], target: number): boolean {
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      if (arr[i] + arr[j] === target) return true;
    }
  }
  return false;
}

export const twoSumSorted: AlgorithmDef = {
  slug: 'two-sum-sorted',
  name: 'Two Sum (sorted)',
  category: 'searching',
  tagline: 'Close in from both ends until the two values add up.',
  intuition: [
    'Checking every pair costs n² comparisons. On a sorted array you can do it in one pass, and the reason is worth understanding rather than memorising.',
    'Put one finger on the smallest value and one on the largest, and add them. If the sum is too small, the only way to increase it is to give up the smallest value — no partner left can rescue it, because every remaining partner is smaller than the one you just tried. If the sum is too large, the same argument eliminates the largest value.',
    'So every comparison discards exactly one element, from one end or the other. That is why one pass is enough: the window can only shrink, and it shrinks by one on every single step.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'arr',
    pointers: [
      { var: 'left', on: 'arr', role: 'window-start', label: 'left', hint: 'Smallest value still in play.' },
      { var: 'right', on: 'arr', role: 'window-end', label: 'right', hint: 'Largest value still in play.' },
    ],
    regions: [
      { on: 'arr', kind: 'eliminated', from: 0, to: 'left - 1', label: 'too small to help' },
      { on: 'arr', kind: 'eliminated', from: 'right + 1', to: 'n - 1', label: 'too large to help' },
      { on: 'arr', kind: 'active', from: 'left', to: 'right', label: 'still in play' },
    ],
    invariant: {
      text: 'If any pair sums to the target, at least one such pair is still inside [left, right].',
      check: 'hasPair === 0 || pairInWindow === 1',
      when: 'defined(pairInWindow)',
      why: 'Every move throws away an element permanently, so the algorithm only works if it can prove that element was in no valid pair. This invariant is that proof, checked. Move the wrong pointer and it breaks on the very step the answer gets discarded.',
    },
    postcondition: {
      text: 'The two indices are different, and the values at them sum to the target — or there is no such pair.',
      check: 'pairOk === 1',
      why: 'A pair of indices is only an answer if it is a pair: two distinct positions whose values add up. Stating it this way catches the whole family of near-misses at once — an index paired with itself, a partner computed with the wrong sign, a lookup keyed by the wrong thing — none of which any loop invariant about the search notices, because each of them searches perfectly well for the wrong thing.',
    },
    cost: {
      text: 'Each index is looked at once: the two pointers only ever move towards each other, so the loop runs fewer times than the array is long.',
      check: 'ops_iterations <= n',
      why: 'This is the whole reason the sorted version beats the nested one, and it is invisible in the answer — a version that restarted a pointer, or moved the wrong one, still finds the pair on most inputs and still returns the right indices. What it loses is the linear bound, and the count is the only place that shows.',
    },
  },
  run,
  defaultInput: { array: [2, 4, 7, 11, 15, 20], target: 18 },
  fields: [
    { key: 'array', label: 'Sorted array', kind: 'array', help: 'Values must be in non-decreasing order.' },
    { key: 'target', label: 'Target sum', kind: 'number' },
  ],
  validate: (input: Input) =>
    isSorted(input.array ?? [])
      ? null
      : 'The two-pointer argument depends on the array being sorted: "the sum is too small, so drop the smallest" is only true if everything to the right really is larger. Run it unsorted and watch the invariant break.',
  makeInput: (n) => ({
    array: Array.from({ length: n }, (_, i) => i + 1),
    target: 3,
  }),
  growthSizes: [16, 32, 64, 128, 256, 512, 1024, 2048],
  projectTo: 1_000_000,
  complexity: {
    time: 'O(n)',
    space: 'O(1)',
    note: 'Each iteration discards one element, so the window shrinks from n to 1 in at most n − 1 steps. Sorting first costs O(n log n), which is why this is only a win when the array arrives sorted or you need many queries against it.',
  },
  userLane: {
    fnName: 'twoSum',
    starters: {
      cpp: `vector<int> twoSum(vector<int>& arr, int target) {
    int left = 0;
    int right = arr.size() - 1;

    while (left < right) {
        int sum = arr[left] + arr[right];

        if (sum == target) return {left, right};

        if (sum < target) {
            left++;
        } else {
            right--;
        }
    }
    return {-1, -1};
}`,
      c: `int* twoSum(int arr[], int n, int target) {
    int out[2];
    int left = 0;
    int right = n - 1;

    while (left < right) {
        int sum = arr[left] + arr[right];

        if (sum == target) {
            out[0] = left;
            out[1] = right;
            return out;
        }

        if (sum < target) {
            left++;
        } else {
            right--;
        }
    }

    out[0] = -1;
    out[1] = -1;
    return out;
}`,
      java: `int[] twoSum(int[] arr, int target) {
    int left = 0;
    int right = arr.length - 1;

    while (left < right) {
        int sum = arr[left] + arr[right];

        if (sum == target) return new int[] { left, right };

        if (sum < target) {
            left++;
        } else {
            right--;
        }
    }
    return new int[] { -1, -1 };
}`,
      js: `function twoSum(arr, target) {
  let left = 0;
  let right = arr.length - 1;

  while (left < right) {
    let sum = arr[left] + arr[right];

    if (sum === target) return left + ',' + right;

    if (sum < target) {
      left++;
    } else {
      right--;
    }
  }
  return '-1,-1';
}`,
    },
    compareBy: 'return',
  },
  mutations: [
    {
      id: 'same-index',
      edits: [{ line: 5, from: 'while (left < right)', to: 'while (left <= right)' }],
      label: 'allow left == right',
      note: 'Lets one element pair with itself, so a target of double any value looks like a hit.',
    },
    {
      id: 'swapped-branches',
      edits: [
        { line: 12, from: 'left++;', to: 'right--;' },
        { line: 14, from: 'right--;', to: 'left++;' },
      ],
      label: 'move the other pointer',
      note: 'Pushes the sum further in the wrong direction and discards the values the answer needs.',
    },
  ],
  variants: [
    {
      id: 'same-index',
      label: 'while (left <= right)',
      blurb: 'Sometimes reports a pair when there is none.',
      explanation:
        'With <= the loop runs one more time, when left and right point at the same element — and then it adds that element to itself. If the target happens to be double some value, the algorithm reports a "pair" made of one element used twice. The condition is not a formality; it is what enforces that the two indices are distinct.',
      mutations: ['same-index'],
    },
    {
      id: 'swapped-branches',
      label: 'the pointers move the wrong way',
      blurb: 'Discards the answer almost immediately.',
      explanation:
        'When the sum is too small you need a *larger* value, and the only way to get one is to abandon the smallest — so left must move. Moving right instead makes the sum smaller still, and worse, it throws away the large values the answer needs. The invariant catches it the first time a pair leaves the window.',
      mutations: ['swapped-branches'],
    },
  ],
  edgeCases: [
    { id: 'ends', label: 'Answer is the two ends', input: { array: [2, 4, 7, 11, 15, 20], target: 22 }, why: 'Found on the very first comparison — the best case.' },
    { id: 'middle', label: 'Answer is in the middle', input: { array: [2, 4, 7, 11, 15, 20], target: 18 }, why: 'Both pointers have to travel before they meet the answer.' },
    { id: 'none', label: 'No pair works', input: { array: [2, 4, 7, 11, 15, 20], target: 100 }, why: 'The window shrinks to nothing. This is the worst case.' },
    { id: 'double', label: 'Target is double an element', input: { array: [1, 3], target: 6 }, why: 'There is no valid pair — 3 + 3 would need the same element twice. This is the case a <= in the loop condition gets wrong.' },
    { id: 'dupes', label: 'Duplicates', input: { array: [3, 3, 3, 3], target: 6 }, why: 'Two different elements that happen to be equal is a perfectly good answer.' },
    { id: 'two', label: 'Two elements', input: { array: [1, 9], target: 10 }, why: 'One comparison, then the loop condition ends it.' },
    { id: 'unsorted', label: 'Unsorted input', input: { array: [9, 2, 15, 4], target: 6 }, why: 'The precondition is broken, so "drop the smallest" is no longer a valid deduction. Watch the invariant fail.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 12 },
      question: 'Moving left forward gives up the smallest remaining value. Why is that safe?',
      options: [
        'Because it could not pair with anything to reach the target',
        'Because it has already been tried against everything',
        'Because the array is sorted, so it is the least useful value',
        'It is not safe — it is a heuristic',
      ],
      answer: 'Because it could not pair with anything to reach the target',
      because:
        'The sum with the largest available partner was already too small, and every other partner is smaller still — so this value cannot reach the target with anything left in the window. That is a proof, not a guess, and it is what lets the window shrink from one side without ever backtracking.',
    }),
    conceptual({
      where: { line: 5, nth: 1 },
      question: 'What would break if the array were not sorted?',
      options: [
        'The reasoning for moving a pointer would no longer hold',
        'The loop would not terminate',
        'It would still work, just more slowly',
        'It would read outside the array',
      ],
      answer: 'The reasoning for moving a pointer would no longer hold',
      because:
        'Every pointer move is justified by knowing that everything to the left is smaller and everything to the right is larger. Without that, a discarded value might have been exactly the partner needed. The loop still runs and still terminates — it just quietly returns the wrong answer, which is the more dangerous failure.',
    }),
    computed({
      where: { line: 6, nth: 1 },
      question: (step) => `The window is now ${step.vars.left} to ${step.vars.right}. How many pairs has the search ruled out so far?`,
      answer: (step) => {
        const n = num(step, 'n');
        const width = num(step, 'right') - num(step, 'left') + 1;
        return String((n * (n - 1)) / 2 - (width * (width - 1)) / 2);
      },
      options: (a, step) => [a, '1', '2', String(num(step, 'n'))],
      because:
        'Each pointer move eliminates every pair involving the value it left behind, not just the one pair that was tested. That is why two pointers solve in one pass what a nested loop needs n² comparisons for — the sortedness converts one comparison into a verdict on a whole row of the table.',
    }),
    {
      locate: (trace) => trace.steps.findIndex((s) => s.line === 11),
      question: (trace, at) => {
        const v = trace.steps[at].vars;
        return `The sum is ${v.sum} and the target is ${v.target}. Which pointer has to move, and why?`;
      },
      options: () => [
        'left, to give up the smallest value',
        'right, to give up the largest value',
        'both, to close in faster',
        'neither — the array should be re-sorted',
      ],
      answer: (trace, at) => {
        const v = trace.steps[at].vars;
        return Number(v.sum) < Number(v.target)
          ? 'left, to give up the smallest value'
          : 'right, to give up the largest value';
      },
      because: () =>
        'The sum can only be increased by dropping the smallest value, and only decreased by dropping the largest. Moving the other pointer would push the sum further in the wrong direction and throw away elements the answer might need.',
    },
  ],
};
