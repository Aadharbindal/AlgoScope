import { cell, ev } from '../trace/tracer';
import { Tracer } from '../trace/tracer';
import { computed, conceptual, num } from './checkpoints';
import { permutationFlag, sortedFlag } from './claims';
import { AlgorithmDef, RunFn } from './types';

const CPP = `void selectionSort(vector<int>& arr) {
    int n = arr.size();

    for (int i = 0; i < n - 1; i++) {
        int minIdx = i;

        for (int j = i + 1; j < n; j++) {
            if (arr[j] < arr[minIdx])
                minIdx = j;
        }

        if (minIdx != i)
            swap(arr[i], arr[minIdx]);
    }
}`;

const C = `void selectionSort(int arr[], int size) {
    int n = size;

    for (int i = 0; i < n - 1; i++) {
        int minIdx = i;

        for (int j = i + 1; j < n; j++) {
            if (arr[j] < arr[minIdx])
                minIdx = j;
        }

        if (minIdx != i)
            { int t = arr[i]; arr[i] = arr[minIdx]; arr[minIdx] = t; }
    }
}`;

const JAVA = `void selectionSort(int[] arr) {
    int n = arr.length;

    for (int i = 0; i < n - 1; i++) {
        int minIdx = i;

        for (int j = i + 1; j < n; j++) {
            if (arr[j] < arr[minIdx])
                minIdx = j;
        }

        if (minIdx != i)
            { int t = arr[i]; arr[i] = arr[minIdx]; arr[minIdx] = t; }
    }
}`;

/** The two numbers that make the prefix invariant checkable. */
function derive(t: Tracer, arr: number[], i: number) {
  if (!t.tracing) return;
  let maxSorted = -Infinity;
  for (let k = 0; k < i; k++) maxSorted = Math.max(maxSorted, arr[k]);
  let minActive = Infinity;
  for (let k = i; k < arr.length; k++) minActive = Math.min(minActive, arr[k]);
  t.derive({ maxSorted, minActive });
}

interface Opts {
  /** The buggy comparison picks the largest instead of the smallest. */
  pickLargest: boolean;
  /** The buggy comparison also accepts equals, so the last one wins. */
  acceptEqual: boolean;
}

function makeRun(opts: Opts): RunFn {
  return (input, t) => {
    const arr = (input.array ?? []).slice();
    // Kept so the result can be checked for having the same values it began
    // with — a sort that drops one is sorted and wrong.
    const original = arr.slice();
    t.array('arr', arr, 'arr');
    t.enter('selectionSort', 'selectionSort(arr)');

    const n = arr.length;
    let i: number | null = null;
    let j: number | null = null;
    let minIdx: number | null = null;

    t.step(2, { n, i, j, minIdx }, `The array has ${n} element${n === 1 ? '' : 's'}.`);

    for (i = 0; i < n - 1; i++) {
      derive(t, arr, i);
      t.step(4, { n, i, j, minIdx }, () => `Pass ${(i as number) + 1}. Indices 0 to ${(i as number) - 1} are already final; find the smallest value left in arr[${i}..${n - 1}].`);

      minIdx = i;
      t.step(5, { n, i, j, minIdx }, () => `Assume arr[${i}] = ${arr[i as number]} is the smallest until something beats it.`);

      for (j = i + 1; j < n; j++) {
        t.tick();
        const a = arr[j];
        const b = arr[minIdx];
        const beats = opts.pickLargest ? a > b : opts.acceptEqual ? a <= b : a < b;
        t.step(
          8,
          { n, i, j, minIdx },
          () =>
            `Compare arr[${j}] = ${a} against the current best arr[${minIdx}] = ${b}. ${
              beats ? 'New best.' : 'Not better — keep looking.'
            }`,
          ev.cmp(cell('arr', j), opts.pickLargest ? '>' : opts.acceptEqual ? '<=' : '<', cell('arr', minIdx as number), beats),
        );
        if (beats) {
          minIdx = j;
          t.step(9, { n, i, j, minIdx }, () => `arr[${j}] is the new best. minIdx moves to ${minIdx}.`);
        }
      }

      const needsSwap = minIdx !== i;
      t.step(12, { n, i, j, minIdx }, () => (needsSwap ? `The smallest remaining value sits at index ${minIdx}, not ${i}. It has to move.` : `The smallest remaining value is already at index ${i}. No swap needed.`));

      if (needsSwap) {
        const a = arr[i];
        const b = arr[minIdx];
        arr[i] = b;
        arr[minIdx] = a;
        derive(t, arr, i + 1);
        t.step(13, { n, i, j, minIdx }, () => `Swap ${a} and ${b}. Index ${i} is now final and will never be touched again.`, ev.swap('arr', i as number, minIdx as number));
      } else {
        derive(t, arr, i + 1);
      }
    }

    t.derive({
      maxSorted: null,
      minActive: null,
      isSorted: sortedFlag(arr),
      kept: permutationFlag(arr, original),
    });
    t.step(15, { n, i, j, minIdx }, () => `Sorted: [${arr.join(', ')}]`);
    t.exit();
    return arr.join(',');
  };
}

const run: RunFn = (input, t, mut) =>
  makeRun({
    pickLargest: mut.has('pick-largest'),
    acceptEqual: mut.has('accept-equal'),
  })(input, t, mut);

export const selectionSort: AlgorithmDef = {
  slug: 'selection-sort',
  name: 'Selection Sort',
  category: 'sorting',
  tagline: 'Find the smallest value left, put it in place, repeat.',
  intuition: [
    'Look through everything that is not yet sorted, find the single smallest value, and swap it into the next free slot. That slot is now finished forever.',
    'Compare that with bubble sort, which moves values a little at a time through many swaps. Selection sort does the opposite: a great deal of looking and at most one swap per pass. That trade matters when a swap is expensive — writing to slow storage, say — because selection sort performs at most n − 1 of them no matter how scrambled the input is.',
    'It is still O(n²), and unlike bubble sort it cannot detect that the array is already sorted. The scan happens whether it needs to or not.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'arr',
    pointers: [
      { var: 'i', on: 'arr', role: 'boundary', label: 'i', hint: 'The slot being filled this pass.' },
      { var: 'j', on: 'arr', role: 'cursor', label: 'j', hint: 'The candidate being examined.' },
      { var: 'minIdx', on: 'arr', role: 'probe', label: 'min', hint: 'Smallest value found so far this pass.' },
    ],
    regions: [
      { on: 'arr', kind: 'sorted', from: 0, to: 'i - 1', label: 'final position' },
      { on: 'arr', kind: 'active', from: 'i', to: 'n - 1', label: 'still unsorted' },
    ],
    invariant: {
      text: 'Every value already placed is no larger than every value still unsorted.',
      check: 'i === 0 || maxSorted <= minActive',
      when: 'defined(maxSorted) && defined(minActive) && defined(i)',
      why: 'Each pass claims to have found the smallest value remaining. If that claim is ever wrong, a larger value gets locked into a slot the algorithm will never revisit — and the error is permanent, because the sorted prefix is never touched again.',
    },
    postcondition: {
      text: 'The whole array is in order, and holds exactly the values it started with.',
      check: 'isSorted === 1 && kept === 1',
      why: 'The loop invariant above is about progress: it says the part already settled is settled correctly. It is silent on whether the loop ran long enough, and a sort that stops one pass early satisfies it completely while returning an array that is not sorted. This is the claim the caller actually cares about, and it can only be judged once the function has finished.',
    },
  },
  run,
  defaultInput: { array: [64, 25, 12, 22, 11] },
  fields: [{ key: 'array', label: 'Array', kind: 'array' }],
  makeInput: (n) => ({ array: Array.from({ length: n }, (_, k) => ((k * 7919) % n) + 1) }),
  growthSizes: [8, 16, 32, 64, 128, 256, 512],
  projectTo: 100_000,
  complexity: {
    time: 'O(n²) in every case',
    space: 'O(1)',
    note: 'Pass i scans n − i − 1 candidates, and that sum is about n²/2 regardless of the input. Swaps, by contrast, are at most n − 1 in total — the one thing selection sort is genuinely good at.',
  },
  userLane: {
    fnName: 'selectionSort',
    starters: {
      cpp: `void selectionSort(vector<int>& arr) {
    int n = arr.size();

    for (int i = 0; i < n - 1; i++) {
        int minIdx = i;

        for (int j = i + 1; j < n; j++) {
            if (arr[j] < arr[minIdx]) {
                minIdx = j;
            }
        }

        if (minIdx != i) {
            swap(arr[i], arr[minIdx]);
        }
    }
}`,
      c: `void selectionSort(int arr[], int n) {
    for (int i = 0; i < n - 1; i++) {
        int minIdx = i;

        for (int j = i + 1; j < n; j++) {
            if (arr[j] < arr[minIdx]) {
                minIdx = j;
            }
        }

        if (minIdx != i) {
            int tmp = arr[i];
            arr[i] = arr[minIdx];
            arr[minIdx] = tmp;
        }
    }
}`,
      java: `void selectionSort(int[] arr) {
    int n = arr.length;

    for (int i = 0; i < n - 1; i++) {
        int minIdx = i;

        for (int j = i + 1; j < n; j++) {
            if (arr[j] < arr[minIdx]) {
                minIdx = j;
            }
        }

        if (minIdx != i) {
            int tmp = arr[i];
            arr[i] = arr[minIdx];
            arr[minIdx] = tmp;
        }
    }
}`,
      js: `function selectionSort(arr) {
  let n = arr.length;

  for (let i = 0; i < n - 1; i++) {
    let minIdx = i;

    for (let j = i + 1; j < n; j++) {
      if (arr[j] < arr[minIdx]) {
        minIdx = j;
      }
    }

    if (minIdx !== i) {
      let tmp = arr[i];
      arr[i] = arr[minIdx];
      arr[minIdx] = tmp;
    }
  }
  return arr;
}`,
    },
    compareBy: 'array',
  },
  mutations: [
    {
      id: 'pick-largest',
      edits: [{ line: 8, from: 'arr[j] < arr[minIdx]', to: 'arr[j] > arr[minIdx]' }],
      label: 'pick the largest',
      note: 'Selects the biggest remaining value each pass, so the array comes out descending.',
    },
    {
      id: 'accept-equal',
      edits: [{ line: 8, from: 'arr[j] < arr[minIdx]', to: 'arr[j] <= arr[minIdx]' }],
      label: 'accept ties',
      note: 'Keeps moving minIdx across equal values, so the last of a tie wins — breaking stability.',
    },
  ],
  variants: [
    {
      id: 'pick-largest',
      label: 'arr[j] > arr[minIdx]',
      blurb: 'Produces a perfectly ordered array — in the wrong direction.',
      explanation:
        'Flipping the comparison selects the largest remaining value each pass instead of the smallest, so the array comes out in descending order. The structure of the algorithm is untouched and every other line is correct — a reminder that in a comparison sort the comparison is the algorithm.',
      mutations: ['pick-largest'],
    },
    {
      id: 'accept-equal',
      label: 'arr[j] <= arr[minIdx]',
      blurb: 'Sorts correctly, but quietly reorders values that compare equal.',
      explanation:
        'With <= the scan keeps moving minIdx forward across ties, so the *last* of several equal values is the one selected. The sorted output looks identical, but records that compared equal have swapped places. That is a stability bug: invisible on plain numbers, and a real defect the moment each value carries other fields with it.',
      mutations: ['accept-equal'],
    },
  ],
  edgeCases: [
    { id: 'sorted', label: 'Already sorted', input: { array: [1, 2, 3, 4, 5] }, why: 'Still does every comparison. Selection sort has no early exit — this is where bubble sort beats it.' },
    { id: 'reversed', label: 'Reverse sorted', input: { array: [5, 4, 3, 2, 1] }, why: 'Maximum swapping, but the comparison count is identical to every other input.' },
    { id: 'dupes', label: 'All equal', input: { array: [3, 3, 3, 3] }, why: 'No swap is ever needed. This is the input that exposes the <= stability bug.' },
    { id: 'two', label: 'Two elements', input: { array: [2, 1] }, why: 'One pass, one comparison, one swap.' },
    { id: 'single', label: 'One element', input: { array: [9] }, why: 'The outer loop condition i < n - 1 is false immediately.' },
    { id: 'empty', label: 'Empty', input: { array: [] }, why: 'n - 1 is -1. Check that your loop bound survives that.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 12 },
      question: 'Selection sort makes exactly n − 1 swaps. Why is that worth knowing?',
      options: [
        'Because a swap can be far more expensive than a comparison',
        'Because it makes the sort faster overall',
        'Because it makes the sort stable',
        'Because it means fewer comparisons too',
      ],
      answer: 'Because a swap can be far more expensive than a comparison',
      because:
        'It is still O(n²) and still loses to every fast sort on time. But comparisons are cheap and moves are not — writing to flash memory, or shuffling large records — and selection sort makes the fewest moves of any sort here. Complexity class is not the only axis, and this is the clearest case of it.',
    }),
    computed({
      // Line 7 is the inner `for` header and is never stepped on; line 5 is
      // where the round starts.
      where: { line: 5, nth: 1 },
      question: (step) => `Round ${num(step, 'i') + 1} is scanning for the smallest value. How many comparisons will this round make?`,
      answer: (step) => String(num(step, 'n') - num(step, 'i') - 1),
      options: (a, step) => [a, String(num(step, 'n')), String(num(step, 'i')), '1'],
      because:
        'Every element after i is compared, whatever the array looks like. There is no early exit and no way to add one — the smallest remaining value could be the last one checked — which is why selection sort is quadratic even on input that is already sorted.',
    }),
    conceptual({
      where: { line: 13 },
      question: 'This swap can move an element past several equal values. What does that cost?',
      options: [
        'Stability — equal items can end up in a different relative order',
        'Correctness — the array may not be sorted',
        'Nothing, swapping is always safe',
        'An extra comparison',
      ],
      answer: 'Stability — equal items can end up in a different relative order',
      because:
        'The swap throws whatever was at position i over to where the minimum used to be, jumping it over everything in between. If some of those were equal to it, their original order is gone. Selection sort is the standard example of an unstable sort, and this single line is the reason.',
    }),
    {
      locate: (trace) => trace.steps.findIndex((s) => s.line === 12),
      question: () => 'This pass has finished scanning. Which index is about to become final?',
      options: (trace, at) => {
        const v = trace.steps[at].vars;
        const i = Number(v.i);
        const n = Number(v.n);
        return [...new Set([i, Number(v.minIdx), n - 1, i + 1])]
          .filter((x) => x >= 0 && x < n)
          .sort((a, b) => a - b)
          .map((x) => `index ${x}`);
      },
      answer: (trace, at) => `index ${Number(trace.steps[at].vars.i)}`,
      because: () =>
        'The pass was looking for the smallest value in arr[i..n-1] so that it could be placed at index i. Once the swap happens, i is finished — minIdx was only ever where that value happened to be sitting.',
    },
  ],
};
